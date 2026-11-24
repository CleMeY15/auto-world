"""Read supplied vehicle pages using Python's standard library. JSON on stdout."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

from browser_archive import ARCHIVE_FORMATS, MAX_ARCHIVE_BYTES, read_archive
from custom_detail import DetailError, DetailHTML, MAX_BYTES, parse_detail
from mobile_print import MAX_PDF_BYTES, parse_pdf
from own_fetch import read_public_html, save_new_private
from parking_detail import parse_parking
from parking_results import parse_results

KINDS = ("detail", "parking-results")
LOCAL_ORIGINS = ("archived", "indexed", "indirect", "synthetic")


def read_limited(path, limit=MAX_BYTES):
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise DetailError("too_large", "Document exceeds its size limit.")
    return data


def read_document(data, url, kind, fmt, provenance):
    if fmt == "pdf":
        if kind != "detail" or provenance == "direct-origin":
            raise DetailError("invalid_mode", "PDF printouts are local individual documents.")
        row = parse_pdf(data, url)
        digest = hashlib.sha256(data).hexdigest()
        return ([{"provenance": provenance, "document_sha256": digest, "row": row}],
                {"sha256": digest, "format": fmt, "accepted": 1})
    if fmt in ARCHIVE_FORMATS:
        if kind != "detail" or provenance == "direct-origin":
            raise DetailError("invalid_mode", "Browser archives are local individual documents.")
        row, html_digest = read_archive(data, fmt, url)
        digest = hashlib.sha256(data).hexdigest()
        return ([{"provenance": provenance, "document_sha256": digest, "row": row}],
                {"sha256": digest, "html_sha256": html_digest, "format": fmt, "accepted": 1})
    if kind not in KINDS or fmt not in ("html", "text"):
        raise DetailError("invalid_mode", "Unknown document kind or format.")
    digest = hashlib.sha256(data).hexdigest()
    diagnostics = {}
    source_host = urlsplit(url).hostname if url else None
    if kind == "detail" and not url and fmt == "html":
        # A locally saved HTML often carries the origin in its own canonical URL.
        head = DetailHTML()
        head.feed(data.decode("utf-8-sig"))
        head.close()
        if head.urls:
            source_host = urlsplit(head.urls[0]).hostname
    if kind == "parking-results":
        if fmt != "html" or (url and urlsplit(url).hostname not in {"www.leparking.fr", "leparking.fr"}):
            raise DetailError("invalid_input", "Expected a Le Parking HTML results page.")
        report = parse_results(data)
        rows = report["rows"]
        diagnostics = {k: v for k, v in report.items() if k not in {"rows", "observed_values", "conflict_ids"}}
        diagnostics["conflicts"] = len(report["conflict_ids"])
        if not rows and report["status"] != "empty_results":
            raise DetailError("no_usable_cards", "No complete, identifiable vehicle cards on this page.")
    elif source_host in {"www.leparking.fr", "leparking.fr"}:
        if fmt != "html":
            raise DetailError("invalid_format", "Le Parking detail requires HTML.")
        rows = [parse_parking(data, url)]
    else:
        rows = [parse_detail(data, url, format=fmt)]
    return ([{"provenance": provenance, "document_sha256": digest, "row": row} for row in rows],
            {"sha256": digest, "accepted": len(rows), **diagnostics})


def stored_file(entry, base):
    if not isinstance(entry, dict) or not isinstance(entry.get("file"), str):
        raise DetailError("invalid_manifest", "A manifest entry requires a file path.")
    file = (base / entry["file"]).resolve()
    if not file.is_relative_to(base) or not file.is_file():
        raise DetailError("invalid_path", "Manifest files must be regular files under its directory.")
    return file


def parse_file_entry(entry, path):
    url = entry.get("source_url")
    if url is not None and not isinstance(url, str):
        raise DetailError("invalid_url", "The source URL must be a string.")
    extensions = {".pdf": "pdf", ".html": "html", ".htm": "html", ".mht": "mhtml", ".mhtml": "mhtml", ".webarchive": "webarchive"}
    fmt = entry.get("format") or extensions.get(path.suffix.lower(), "text")
    if not isinstance(fmt, str):
        raise DetailError("invalid_mode", "Document format must be a string.")
    origin = entry.get("provenance", "archived")
    if origin not in LOCAL_ORIGINS:
        raise DetailError("invalid_provenance", "Saved files need a local-document provenance.")
    limit = MAX_ARCHIVE_BYTES if fmt in ARCHIVE_FORMATS else MAX_PDF_BYTES if fmt == "pdf" else MAX_BYTES
    return read_document(read_limited(path, limit), url, entry.get("kind", "detail"), fmt, origin)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    one = sub.add_parser("file", help="Read one saved document")
    one.add_argument("file", type=Path)
    one.add_argument("--url", help="Original individual HTTPS URL; required for text")
    one.add_argument("--kind", choices=KINDS, default="detail")
    one.add_argument("--format", choices=("html", "text", "mhtml", "webarchive", "pdf"))
    one.add_argument("--provenance", choices=LOCAL_ORIGINS, default="archived")
    fetch = sub.add_parser("fetch", help="Read one public page inside the configured Le Parking pilot")
    fetch.add_argument("url")
    fetch.add_argument("--kind", choices=KINDS, default="detail")
    fetch.add_argument("--save-html", type=Path, help="Also retain received bytes in a new 0600 file")
    manifest = sub.add_parser("batch", help="Read local documents listed in a JSON manifest")
    manifest.add_argument("manifest", type=Path)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    result = {"observations": [], "documents": [], "errors": []}

    def add(observations, document):
        result["observations"].extend(observations)
        result["documents"].append(document)

    try:
        if args.command == "fetch":
            receipt, body = read_public_html(args.url)
            result["http"] = receipt
            if body is None:
                raise DetailError(receipt["result"], "No usable HTML received.")
            if args.save_html:
                save_new_private(args.save_html, body)
            add(*read_document(body, args.url, args.kind, "html", "direct-origin"))
        elif args.command == "file":
            entry = dict(source_url=args.url, kind=args.kind, format=args.format, provenance=args.provenance)
            add(*parse_file_entry(entry, args.file))
        else:
            entries = json.loads(read_limited(args.manifest))
            if not isinstance(entries, list) or not 1 <= len(entries) <= 2000:
                raise DetailError("invalid_manifest", "Expected 1 to 2000 entries.")
            for i, entry in enumerate(entries):
                try:
                    add(*parse_file_entry(entry, stored_file(entry, args.manifest.resolve().parent)))
                except (ValueError, OSError) as error:
                    result["errors"].append({"entry": i + 1, "code": getattr(error, "code", "input_error"), "message": str(error)})
    except (ValueError, OSError) as error:
        result["errors"].append({"code": getattr(error, "code", "input_error"), "message": str(error)})
    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
    print()
    return 2 if result["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
