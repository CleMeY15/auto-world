"""Local document reader and corpus/web search, served with Uvicorn."""
import json
import os
from contextlib import asynccontextmanager
from urllib.parse import parse_qs

from python_multipart.exceptions import MultipartParseError
from starlette.applications import Starlette
from starlette.datastructures import UploadFile
from starlette.formparsers import MultiPartParser, MultiPartException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route

from documents import MAX_BYTES, ReaderIssue, base_url, convert
from render_client import HTML_LIMIT, render_submitted
from fetch_document import FetchError, Fetcher
from search_index import SearchIndex
from web_search import WebSearchError, search_web

UPLOAD_LIMIT = MAX_BYTES + 128 * 1024
JSON_LIMIT = 6 * MAX_BYTES + 8192  # valid UTF-8 JSON may use six ASCII bytes per escaped byte
HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Vary": "Accept"}


def wants_json(request):
    return "application/json" in request.headers.get("accept", "").lower()


def reply(payload, status=200):
    return JSONResponse({"code": status, "status": 20000 if status == 200 else status * 100, "data": payload},
                        status_code=status, headers=HEADERS)


def fail(exc):
    status = exc.status
    return JSONResponse({"code": status, "error": getattr(exc, "code", None) or getattr(exc, "detail", "request_failed")},
                        status_code=status, headers=HEADERS)


def integer(value, minimum, maximum, field):
    try:
        number = int(value)
        if number < minimum or number > maximum:
            raise ValueError()
        return number
    except (ValueError, TypeError) as exc:
        raise ReaderIssue(400, "invalid_" + field) from exc


async def bounded_body(request, limit):
    raw = bytearray()
    async for part in request.stream():
        if len(raw) + len(part) > limit:
            raise ReaderIssue(413, "request_too_large")
        raw.extend(part)
    return bytes(raw)


def parse_document(raw, content_type):
    mime = content_type.partition(";")[0].strip().lower()
    if mime == "application/json":
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise ReaderIssue(400, "invalid_json") from exc
    elif mime == "application/x-www-form-urlencoded":
        try:
            fields = parse_qs(raw.decode(), keep_blank_values=True, max_num_fields=8)
        except (ValueError, UnicodeError) as exc:
            raise ReaderIssue(400, "invalid_form") from exc
        if any(len(values) != 1 for values in fields.values()):
            raise ReaderIssue(400, "ambiguous_form")
        body = {key: values[0] for key, values in fields.items()}
    else:
        return raw, content_type, ""
    if not isinstance(body, dict) or set(body) - {"url", "text", "html"} or any(not isinstance(v, str) for v in body.values()):
        raise ReaderIssue(400, "expected_url_html_or_text")
    if "html" in body and "text" in body:
        raise ReaderIssue(400, "ambiguous_document")
    for key, kind in (("html", "text/html"), ("text", "text/plain")):
        if key in body:
            try:
                return body[key].encode("utf-8"), kind + "; charset=utf-8", body.get("url", "")
            except UnicodeError as exc:
                raise ReaderIssue(400, "invalid_unicode") from exc
    if not body.get("url"):
        raise ReaderIssue(400, "url_required")
    return None, "", body["url"]


async def multipart_document(request, raw):
    async def stream():
        yield raw
        yield b""
    try:
        parser = MultiPartParser(request.headers, stream(), max_files=1, max_fields=1, max_part_size=4096)
        form = await parser.parse()
        try:
            if set(form) - {"file", "url"} or not isinstance(form.get("file"), UploadFile):
                raise ReaderIssue(400, "expected_single_file")
            url = form.get("url", "")
            if not isinstance(url, str):
                raise ReaderIssue(400, "invalid_source_url")
            part = form["file"]
            raw = await part.read(MAX_BYTES + 1)
            return raw, part.content_type or "application/octet-stream", url
        finally:
            await form.close()
    except (ValueError, MultiPartException, MultipartParseError, KeyError, UnicodeError) as exc:
        raise ReaderIssue(400, "invalid_multipart") from exc


def create_app(*, database=None, fetcher=None, web_provider=search_web):
    @asynccontextmanager
    async def lifespan(app):
        app.state.index = SearchIndex(database or os.getenv("READER_DB", "reader.sqlite3"))
        app.state.fetcher = fetcher if fetcher is not None else Fetcher(
            {host.strip() for host in os.getenv("READER_ALLOWED_HOSTS", "").split(",") if host.strip()})
        try:
            yield
        finally:
            app.state.index.close()

    def read(raw, media, url, mode, selector, refresh, index, app):
        hit = False
        if raw is None:
            raw, media, hit = app.state.fetcher.get(url, refresh=refresh)
        doc = convert(raw, media, url, mode, selector)
        if index:
            app.state.index.put(doc)
        return {**doc, "cacheHit": hit}

    async def reader(request: Request):
        try:
            index = request.url.path == "/v1/index"
            mode = request.headers.get("x-respond-with", "reader").strip().lower()
            selector = request.headers.get("x-target-selector")
            if index and (mode != "reader" or selector is not None):
                raise ReaderIssue(400, "index_requires_full_document")
            if request.method == "POST":
                media = request.headers.get("content-type", "application/json")
                limit = JSON_LIMIT if media.partition(";")[0].lower() == "application/json" else UPLOAD_LIMIT
                raw = await bounded_body(request, limit)
                if media.partition(";")[0].strip().lower() == "multipart/form-data":
                    raw, media, url = await multipart_document(request, raw)
                else:
                    raw, media, url = await run_in_threadpool(parse_document, raw, media)
            elif request.url.path == "/v1/read":
                raw, media, url = None, "", request.query_params.get("url")
            else:
                raw_path = request.scope["raw_path"][1:]
                query = request.scope["query_string"]
                raw, media, url = None, "", (raw_path + (b"?" + query if query else b"")).decode("ascii")
            if raw is None and not url:
                raise ReaderIssue(400, "url_required")
            value = request.headers.get("x-no-cache", "false").lower()
            if value not in {"true", "false"}:
                raise ReaderIssue(400, "invalid_cache_option")
            doc = await run_in_threadpool(read, raw, media, url, mode, selector, value == "true", index, request.app)
            if index or wants_json(request):
                return reply(doc)
            return PlainTextResponse(f"Title: {doc['title']}\n\nURL Source: {doc['url']}\n\n"
                                     + ("Markdown Content:" if mode in {"reader","markdown"} else "Content:")
                                     + "\n" + doc["content"] + "\n", headers=HEADERS)
        except (ReaderIssue, FetchError) as exc:
            return fail(exc)
        except UnicodeError:
            return fail(ReaderIssue(400, "invalid_url_encoding"))

    def search(query, limit, offset, web, hydrate, app):
        if not web:
            try:
                return app.state.index.search(query, limit, offset)
            except ValueError as exc:
                raise ReaderIssue(400, "invalid_search_query") from exc
        if offset:
            raise ReaderIssue(400, "web_offset_unsupported")
        results = web_provider(query, limit)
        for result in results:
            result["readStatus"] = "snippet_only"
            if hydrate:
                try:
                    doc = read(None, "", result["url"], "reader", None, False, False, app)
                    result.update(content=doc["content"], readStatus="read")
                except (FetchError, ReaderIssue) as exc:
                    result["readStatus"] = exc.code
        return results

    async def finder(request):
        try:
            web = request.url.path.startswith("/s/") or request.url.path == "/v1/search/web"
            query = (request.path_params.get("query") or request.query_params.get("q", "")).strip()
            if not query or len(query) > (256 if web else 512):
                raise ReaderIssue(400, "invalid_search_query_length")
            limit = integer(request.query_params.get("limit", 5), 1, 5 if web else 100, "limit")
            offset = integer(request.query_params.get("offset", 0), 0, 1000000, "offset")
            hydrate = request.query_params.get("read", "1")
            if hydrate not in {"0", "1"}:
                raise ReaderIssue(400, "invalid_read")
            rows = await run_in_threadpool(search, query, limit, offset, web, hydrate == "1", request.app)
            if wants_json(request) or request.url.path.startswith("/v1/"):
                return reply(rows)
            lines = (f"[{i}] {row['title']}\n{row['url']}\n{row.get('content') or row['description']}" for i, row in enumerate(rows, 1))
            return PlainTextResponse("\n\n".join(lines) + "\n", headers=HEADERS)
        except (ReaderIssue, WebSearchError) as exc:
            return fail(exc)

    async def render(request):
        try:
            if request.headers.get("content-type", "").split(";")[0].lower() != "application/json":
                raise ReaderIssue(415, "json_required")
            raw = await bounded_body(request, 6 * HTML_LIMIT + 8192)
            try:
                body = json.loads(raw)
            except (ValueError, RecursionError, UnicodeError) as exc:
                raise ReaderIssue(400, "invalid_json") from exc
            if not isinstance(body, dict) or set(body) - {"html","format","selector","url"} or not isinstance(body.get("html"), str):
                raise ReaderIssue(400, "submitted_html_required")
            try:
                size = len(body["html"].encode())
            except UnicodeError as exc:
                raise ReaderIssue(400, "invalid_unicode") from exc
            if not size or size > HTML_LIMIT:
                raise ReaderIssue(413 if size else 422, "render_input_size")
            mode = body.get("format", "markdown")
            selector = body.get("selector")
            if not isinstance(mode, str) or mode not in {"markdown", "text", "html", "screenshot"}:
                raise ReaderIssue(400, "unsupported_output_format")
            if selector is not None and (not isinstance(selector, str) or len(selector) > 82):
                raise ReaderIssue(400, "invalid_selector")
            url = base_url(body.get("url", ""))
            capture = await run_in_threadpool(render_submitted, body["html"], "screenshot" if mode == "screenshot" else "html", selector)
            if mode == "screenshot":
                return Response(capture, media_type="image/png", headers=HEADERS)
            doc = await run_in_threadpool(convert, capture, "text/html; charset=utf-8", url, mode)
            return reply(doc)
        except ReaderIssue as exc:
            return fail(exc)

    async def health(request):
        return JSONResponse({"status":"ok", "service":"autofindex-reader", "index":"sqlite-fts5",
                             "webSearchConfigured": bool(os.getenv("READER_SEARXNG_URL"))}, headers=HEADERS)

    app = Starlette(routes=[
        Route("/health", health),
        Route("/", reader, methods=["POST"]),
        Route("/v1/read", reader, methods=["GET","POST"]),
        Route("/v1/index", reader, methods=["POST"]),
        Route("/v1/render", render, methods=["POST"]),
        Route("/v1/search", finder),
        Route("/v1/search/web", finder),
        Route("/s/{query:path}", finder),
        Route("/https://{target:path}", reader),
    ], lifespan=lifespan)
    async def same_host(request, call_next):
        if request.headers.get("sec-fetch-site") == "cross-site" or (
            "origin" in request.headers and request.headers["origin"] != str(request.base_url).rstrip("/")
        ):
            return fail(ReaderIssue(403, "cross_origin_denied"))
        return await call_next(request)
    app.add_middleware(BaseHTTPMiddleware, dispatch=same_host)
    hosts = ["localhost", "127.0.0.1", "reader"]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)
    return app


app = create_app()
