"""Read only the main HTML resource in a locally supplied mobile.de browser archive."""
from email import policy
from email.parser import BytesParser
import codecs
import hashlib
import plistlib
from xml.parsers.expat import ExpatError

from custom_detail import DetailError, MAX_BYTES, listing_identity, parse_detail
from own_fetch import looks_gated


MAX_ARCHIVE_BYTES = 64_000_000
ARCHIVE_FORMATS = {"mhtml", "webarchive"}
HTML_TYPES = {"text/html", "application/xhtml+xml"}


def fail(message):
    raise DetailError("invalid_archive", message)


def safari_main(data):
    archive = plistlib.loads(data)
    resource = archive.get("WebMainResource") if isinstance(archive, dict) else None
    if not isinstance(resource, dict):
        fail("Safari archive is missing its main resource.")
    return (resource.get("WebResourceURL"), resource.get("WebResourceMIMEType"),
            resource.get("WebResourceData"), resource.get("WebResourceTextEncodingName"))


def mhtml_main(data):
    archive = BytesParser(policy=policy.default).parsebytes(data)
    if archive.get_content_type() != "multipart/related" or not archive.is_multipart():
        fail("Expected a multipart/related browser archive.")
    parts = list(archive.iter_parts())
    start = archive.get_param("start")
    if start is not None:
        roots = [p for p in parts if str(p.get("Content-ID", "")).strip() == start.strip()]
        if len(roots) != 1:
            fail("The archive must identify exactly one main MIME part.")
        root = roots[0]
    elif parts:
        # RFC 2387 defaults to the first part, including when other frames contain HTML.
        root = parts[0]
    else:
        fail("Empty browser archive.")
    if root.get_content_type() not in HTML_TYPES or root.is_multipart():
        fail("The main MIME part must be HTML.")
    url = root.get("Content-Location")
    if not url or len(root.get_all("Content-Location", [])) != 1:
        fail("The main document needs its original URL.")
    snapshot_urls = archive.get_all("Snapshot-Content-Location", [])
    for snapshot in snapshot_urls:
        if listing_identity(str(snapshot))[:2] != listing_identity(str(url))[:2]:
            raise DetailError("ambiguous_identity", "Snapshot and main document identify different listings.")
    html = root.get_payload(decode=True)
    if root.defects or archive.defects:
        fail("Damaged MIME archive.")
    return str(url), root.get_content_type(), html, root.get_content_charset()


def read_archive(data, fmt, supplied_url=None):
    if not isinstance(data, bytes) or not data or len(data) > MAX_ARCHIVE_BYTES:
        fail("Expected a non-empty browser archive up to 64 MB.")
    if fmt not in ARCHIVE_FORMATS:
        fail("Expected MHTML or Safari Web Archive.")
    try:
        url, mime, html, encoding = safari_main(data) if fmt == "webarchive" else mhtml_main(data)
    except DetailError:
        raise
    except (ValueError, TypeError, LookupError, ArithmeticError, RecursionError, EOFError, OSError,
            plistlib.InvalidFileException, ExpatError) as exc:
        raise DetailError("invalid_archive", "Unable to read this browser archive.") from exc
    if not isinstance(mime, str) or mime.split(";", 1)[0].lower().strip() not in HTML_TYPES:
        fail("The archive's main resource must be HTML.")
    if not isinstance(html, bytes) or not 0 < len(html) <= MAX_BYTES:
        fail("The main HTML resource must be between 1 byte and 8 MB.")
    site, key, _ = listing_identity(url)
    if site != "mobile.de":
        raise DetailError("unsupported_url", "Expected a mobile.de detail archive.")
    if supplied_url is not None and listing_identity(supplied_url)[:2] != (site, key):
        raise DetailError("ambiguous_identity", "Supplied URL differs from the archived document.")
    try:
        codec = codecs.lookup(encoding or "utf-8").name
        if codec not in {"utf-8", "utf-8-sig", "utf-16", "utf-16-le", "utf-16-be", "iso8859-1", "cp1252", "ascii"}:
            fail("Unsupported HTML character encoding.")
        decoded = html.decode(codec).lstrip("\ufeff")
    except (LookupError, UnicodeError, TypeError) as exc:
        raise DetailError("invalid_archive", "Unable to decode the archived HTML.") from exc
    if looks_gated(decoded.encode("utf-8")):
        raise DetailError("blocked_or_unavailable", "The archived main document contains a verification screen.")
    row = parse_detail(decoded, url, format="html")
    return row, hashlib.sha256(html).hexdigest()
