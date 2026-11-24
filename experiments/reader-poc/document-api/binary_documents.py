"""Bounded, offline text extraction for PDF and Open XML documents."""
from __future__ import annotations

import io
import posixpath
import re
import shutil
import signal
import subprocess
import tempfile
import zipfile
import zlib
from pathlib import Path
from xml.etree import ElementTree as ET


PDF = "application/pdf"
OFFICE = "application/vnd.openxmlformats-officedocument."
DOCX = OFFICE + "wordprocessingml.document"
XLSX = OFFICE + "spreadsheetml.sheet"
PPTX = OFFICE + "presentationml.presentation"
BINARY_TYPES = frozenset((PDF, DOCX, XLSX, PPTX))

MAX_INPUT = 8 * 1024 * 1024
MAX_TEXT = 1024 * 1024
MAX_ARCHIVE = 32 * 1024 * 1024
MAX_XML = 4 * 1024 * 1024
MAX_ENTRIES = 2048


class DocumentError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


def _invalid(message: str) -> DocumentError:
    return DocumentError(422, "invalid_document", message)


def _limit() -> DocumentError:
    return DocumentError(413, "document_limit", "Document exceeds the conversion limits.")


class _XMLBuilder(ET.TreeBuilder):
    def __init__(self):
        super().__init__()
        self.depth = self.nodes = 0

    def doctype(self, name, pubid, system):
        raise _invalid("Document type declarations are unsupported.")

    def start(self, tag, attrs):
        self.depth += 1
        self.nodes += 1
        if self.depth > 128 or self.nodes > 100_000:
            raise _limit()
        return super().start(tag, attrs)

    def end(self, tag):
        self.depth -= 1
        return super().end(tag)


def _tag(name):
    return name.rsplit("}", 1)[-1]


def _elements(root, name):
    return (node for node in root.iter() if _tag(node.tag) == name)


def _parts_text(root):
    return "".join(n.text or "" for n in _elements(root, "t"))


class _Package:
    def __init__(self, archive):
        entries = archive.infolist()
        self.names = {entry.filename for entry in entries}
        self.archive = archive
        if len(entries) != len(self.names):
            raise _invalid("Duplicate document parts.")
        if len(entries) > MAX_ENTRIES or sum(x.file_size for x in entries) > MAX_ARCHIVE:
            raise _limit()
        self.remaining = MAX_ARCHIVE

    def xml(self, name):
        if name not in self.names:
            raise _invalid("Missing required document part.")
        info = self.archive.getinfo(name)
        if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or info.flag_bits & 1:
            raise _invalid("Unsupported compression or encrypted document part.")
        size = info.file_size
        if size > MAX_XML or size > self.remaining:
            raise _limit()
        self.remaining -= size
        with self.archive.open(name) as part:
            data = part.read(MAX_XML + 1)
        if len(data) != size:
            raise _invalid("Invalid document part length.")
        parser = ET.XMLParser(target=_XMLBuilder())
        return ET.fromstring(data, parser=parser)

    def ordered_parts(self, main, item_name, rel_type):
        root = self.xml(main)
        folder, base = posixpath.split(main)
        relationships = self.xml(posixpath.join(folder, "_rels", base + ".rels"))
        local_parts = {}
        for node in _elements(relationships, "Relationship"):
            attrs = node.attrib
            if attrs.get("TargetMode", "Internal") != "Internal":
                continue
            if attrs.get("Type", "").rsplit("/", 1)[-1] != rel_type:
                continue
            target = attrs.get("Target", "")
            if not target or ":" in target or "\\" in target:
                continue
            name = posixpath.normpath(posixpath.join(folder, target)).lstrip("/")
            local_parts[attrs.get("Id", "")] = name
        seen = set()
        for item in _elements(root, item_name):
            relation = next((v for k, v in item.attrib.items() if k.endswith("}id")), "")
            name = local_parts.get(relation)
            if name is None:
                # Excel can include chartsheets and other non-worksheet sheets.
                if rel_type == "worksheet":
                    continue
                raise _invalid("Slide relationship could not be resolved.")
            if name in seen:
                raise _invalid("Duplicate sheet or slide relationship.")
            seen.add(name)
            yield item, self.xml(name)


class _Text:
    def __init__(self):
        self.data = io.StringIO()
        self.remaining = MAX_TEXT

    def append(self, value):
        if len(value) > self.remaining:
            raise _limit()
        self.remaining -= len(value)
        self.data.write(value)

    def value(self):
        return self.data.getvalue().strip()


def _paragraphs(root, output):
    for paragraph in _elements(root, "p"):
        for node in paragraph.iter():
            tag = _tag(node.tag)
            if tag == "t":
                output.append(node.text or "")
            elif tag == "tab":
                output.append("\t")
            elif tag in {"br", "cr"}:
                output.append("\n")
        output.append("\n")


def _spreadsheet(package, output):
    shared = []
    shared_path = "xl/sharedStrings.xml"
    if shared_path in package.names:
        shared = [_parts_text(n) for n in _elements(package.xml(shared_path), "si")]
    for sheet, root in package.ordered_parts("xl/workbook.xml", "sheet", "worksheet"):
        output.append(sheet.attrib.get("name", "") + "\n")
        for row in _elements(root, "row"):
            previous = 0
            for cell in row:
                if _tag(cell.tag) != "c":
                    continue
                ref = re.fullmatch(r"([A-Z]{1,3})[1-9][0-9]{0,6}", cell.get("r", ""))
                column = previous + 1
                if ref:
                    column = 0
                    for char in ref.group(1):
                        column = column * 26 + ord(char) - 64
                if column <= previous or column > 16_384:
                    raise _invalid("Invalid spreadsheet column.")
                output.append("\t" * (column - max(1, previous)))
                previous = column
                value = next((n.text or "" for n in cell if _tag(n.tag) == "v"), "")
                kind = cell.get("t")
                if kind == "s":
                    if not value.isascii() or not value.isdecimal() or len(value) > 8 or int(value) >= len(shared):
                        raise _invalid("Invalid shared string reference.")
                    value = shared[int(value)]
                elif kind == "inlineStr":
                    value = _parts_text(cell)
                elif kind == "b":
                    value = {"0": "FALSE", "1": "TRUE"}.get(value, value)
                output.append(value)
            output.append("\n")
        output.append("\n")


def _office(raw, media_type):
    output = _Text()
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            package = _Package(archive)
            title = ""
            if "docProps/core.xml" in package.names:
                meta = package.xml("docProps/core.xml")
                title = next((n.text or "" for n in _elements(meta, "title")), "").strip()[:1024]
            if media_type == DOCX:
                _paragraphs(package.xml("word/document.xml"), output)
            elif media_type == XLSX:
                _spreadsheet(package, output)
            else:
                for _, slide in package.ordered_parts("ppt/presentation.xml", "sldId", "slide"):
                    _paragraphs(slide, output)
                    output.append("\n")
    except (zipfile.BadZipFile, ET.ParseError, LookupError, ValueError, RuntimeError, NotImplementedError, EOFError, OSError, zlib.error) as exc:
        raise _invalid("Unreadable Open XML document.") from exc
    return title, output.value()


def _pdf(raw):
    converter, limiter = shutil.which("pdftotext"), shutil.which("prlimit")
    if not converter or not limiter:
        raise DocumentError(503, "converter_unavailable", "PDF text conversion requires Poppler and util-linux.")
    if b"%PDF-" not in raw[:1024]:
        raise _invalid("Missing PDF signature.")
    with tempfile.TemporaryDirectory(prefix="reader-pdf-") as tmp:
        src, dst = Path(tmp, "input.pdf"), Path(tmp, "output.txt")
        src.write_bytes(raw)
        try:
            # prlimit applies OS limits to Poppler without a fork hook in the HTTP worker.
            proc = subprocess.run(
                [limiter, "--as=402653184", "--cpu=6", f"--fsize={MAX_TEXT + 1}",
                 "--", converter, "-enc", "UTF-8", "-nopgbrk", str(src), str(dst)],
                cwd=tmp, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, timeout=10, check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise DocumentError(422, "conversion_timeout", "PDF conversion exceeded its time budget.") from exc
        if dst.exists() and dst.stat().st_size > MAX_TEXT:
            raise _limit()
        if proc.returncode == -signal.SIGXFSZ:
            raise _limit()
        if proc.returncode or not dst.is_file():
            raise _invalid("Unreadable, encrypted or overly complex PDF.")
        return "", dst.read_text(encoding="utf-8", errors="replace").strip()


def convert_binary(raw: bytes, media_type: str) -> tuple[str, str]:
    """Read modern Office document text or a PDF text layer; return title and body."""
    kind = media_type.partition(";")[0].strip().lower()
    if kind not in BINARY_TYPES:
        raise DocumentError(415, "unsupported_media_type", "Unsupported document format.")
    if len(raw) > MAX_INPUT:
        raise _limit()
    title, body = _pdf(raw) if kind == PDF else _office(raw, kind)
    if not body:
        raise DocumentError(422, "no_document_text", "Document contains no extractable text.")
    return title, body
