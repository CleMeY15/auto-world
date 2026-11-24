"""Convert already-acquired documents without fetching any linked resource."""
import codecs
import io
import tempfile
import threading
import zipfile
import hashlib
import re
import shutil
import subprocess
from email.message import Message
from urllib.parse import urljoin, urlsplit

from lxml import etree, html

from binary_documents import DOCX, PDF, PPTX, XLSX, DocumentError, convert_binary

MAX_BYTES = 2 * 1024 * 1024
MAX_OUTPUT = 4 * 1024 * 1024
HTML_TYPES = {"text/html", "application/xhtml+xml"}
_SLOTS = threading.BoundedSemaphore(4)
FORMATS = {"reader", "markdown", "text", "html"}


class ReaderIssue(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


def base_url(value):
    if not value:
        return ""
    if not isinstance(value, str) or len(value) > 4096 or re.search(r"[\x00-\x20\x7f\\]", value):
        raise ReaderIssue(400, "invalid_source_url")
    try:
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username is not None or parts.password is not None:
            raise ValueError()
        _ = parts.port
    except ValueError as exc:
        raise ReaderIssue(400, "invalid_source_url") from exc
    return value


def clean_text(value):
    return " ".join(value.split())


def pick_element(root, selector):
    if not re.fullmatch(r"[#.]?[A-Za-z][\w-]{0,80}", selector, re.ASCII):
        raise ReaderIssue(400, "expected_id_class_or_tag_selector")
    if selector.startswith("#"):
        matches = root.xpath("descendant-or-self::*[@id=$v]", v=selector[1:])
    elif selector.startswith("."):
        matches = root.xpath("descendant-or-self::*[contains(concat(' ',normalize-space(@class),' '),$v)]", v=" "+selector[1:]+" ")
    else:
        matches = root.xpath("descendant-or-self::*[local-name()=$v]", v=selector.lower())
    if not matches:
        raise ReaderIssue(422, "selector_not_found")
    return matches[0]


def render(fragment, target):
    if target == "html":
        return fragment
    if not shutil.which("pandoc") or not shutil.which("prlimit"):
        raise ReaderIssue(503, "pandoc_or_prlimit_missing")
    command = ["prlimit", "--cpu=6", "--as=805306368", f"--fsize={MAX_OUTPUT + 1}", "--", "pandoc",
               "--sandbox", "--from=html", "--to=" + ("plain" if target == "text" else "gfm-raw_html"), "--wrap=none"]
    with tempfile.TemporaryFile() as output:
        try:
            run = subprocess.run(command, input=fragment.encode(), stdout=output,
                                 stderr=subprocess.DEVNULL, timeout=8, check=False)
        except subprocess.TimeoutExpired as exc:
            raise ReaderIssue(504, "conversion_timeout") from exc
        if output.tell() > MAX_OUTPUT:
            raise ReaderIssue(413, "output_too_large")
        if run.returncode:
            raise ReaderIssue(422, "conversion_failed")
        output.seek(0)
        return output.read().decode().strip()



def extract_html(raw, charset, url, mode, selector):
    if not charset:
        try:
            raw.decode("utf-8")
            charset = "utf-8"
        except UnicodeDecodeError:
            pass  # libxml checks the document's encoding declaration.
    try:
        root = html.document_fromstring(raw, parser=html.HTMLParser(encoding=charset, no_network=True, remove_comments=True))
    except (etree.ParserError, LookupError, ValueError) as exc:
        raise ReaderIssue(422, "invalid_html") from exc
    title = clean_text(root.xpath("string((//title)[1])") or root.xpath("string((//h1)[1])"))
    description = clean_text(root.xpath("string((//meta[translate(@name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='description']/@content)[1])"))
    body = root.find("body")
    head = root.find("head")
    if head is not None:
        # libxml's HTML4 parser may leave HTML5 article/main elements in an implicit head.
        misplaced = [n for n in head if n.tag not in {"base","link","meta","noscript","script","style","template","title"}]
        if misplaced:
            if body is None:
                body = etree.SubElement(root, "body")
            for index, node in enumerate(misplaced):
                body.insert(index, node)
    if body is None:
        raise ReaderIssue(422, "empty_document")
    for node in body.xpath(".//script|.//style|.//template|.//noscript|.//iframe|.//object|.//embed|.//form|.//svg|.//canvas|.//*[@hidden]|.//*[@aria-hidden='true']"):
        if node.getparent() is not None:
            node.drop_tree()
    if selector:
        body = pick_element(body, selector)
    elif mode == "reader":
        mains = body.xpath(".//main|.//article")
        if len(mains):
            body = mains[0]
        for node in body.xpath(".//nav|.//aside|.//footer"):
            node.drop_tree()
    for node in body.iter():
        if not isinstance(node.tag, str):
            continue
        for key in list(node.attrib):
            value = node.get(key)
            if key in {"href", "src"} and ((node.tag == "a" and key == "href") or (node.tag == "img" and key == "src")):
                try:
                    absolute = urljoin(url, value.strip())
                    if urlsplit(absolute).scheme in {"https", "http"} and not re.search(r"[\x00-\x1f\x7f]", absolute):
                        node.set(key, absolute)
                        continue
                except ValueError:
                    pass
            if key not in {"alt", "rowspan", "colspan"}:
                del node.attrib[key]
    fragment = etree.tostring(body, method="html", encoding="unicode", with_tail=False)
    if len(fragment.encode()) > MAX_OUTPUT:
        raise ReaderIssue(413, "output_too_large")
    return title, description, render(fragment, mode)


def convert(raw, media_type, source="", mode="reader", selector=None):
    if not _SLOTS.acquire(blocking=False):
        raise ReaderIssue(503, "conversion_busy")
    try:
        return _convert(raw, media_type, source, mode, selector)
    finally:
        _SLOTS.release()


def _convert(raw, media_type, source, mode, selector):
    if mode not in FORMATS:
        raise ReaderIssue(400, "unsupported_output_format")
    if not raw:
        raise ReaderIssue(422, "empty_document")
    if len(raw) > MAX_BYTES:
        raise ReaderIssue(413, "document_too_large")
    source = base_url(source)
    header = Message()
    header["content-type"] = media_type
    mime = header.get_content_type()
    if mime == "application/octet-stream":
        if b"%PDF-" in raw[:1024]:
            mime = PDF
        elif raw.startswith(b"PK\x03\x04"):
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as package:
                    names = set(package.namelist())
                if "[Content_Types].xml" in names:
                    kinds = [typ for path, typ in (("word/document.xml", DOCX), ("xl/workbook.xml", XLSX),
                             ("ppt/presentation.xml", PPTX)) if path in names]
                    if len(kinds) == 1:
                        mime = kinds[0]
            except (zipfile.BadZipFile, ValueError):
                pass
    charset = header.get_content_charset()
    title = description = ""
    if mime in HTML_TYPES:
        title, description, content = extract_html(raw, charset, source, mode, selector)
    elif selector or mode == "html":
        raise ReaderIssue(400, "html_input_required_for_option")
    elif mime in {"text/plain", "text/markdown"}:
        try:
            content = raw.decode(codecs.lookup(charset or "utf-8-sig").name).strip()
        except (LookupError, UnicodeDecodeError) as exc:
            raise ReaderIssue(422, "invalid_text_encoding") from exc
    else:
        try:
            title, content = convert_binary(raw, mime)
        except DocumentError as exc:
            raise ReaderIssue(exc.status, exc.code) from exc
    if not content.strip():
        raise ReaderIssue(422, "no_readable_text")
    digest = hashlib.sha256(raw).hexdigest()
    return dict(title=title, description=description, url=source or "urn:sha256:" + digest,
                content=content, mimeType=mime, sha256=digest)
