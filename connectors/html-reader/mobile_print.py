"""Read an operator-supplied mobile.de listing printout locally; no network I/O."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError as ReadTimeout
import re
import subprocess
import tempfile

from custom_detail import BAD_SCREEN, DetailError, compact, kilometers, listing_identity, one, parse_amount, year_of

MAX_PDF_BYTES = 16_000_000
MAX_PRINT_TEXT = 2_000_000
DISPLAY_ID = re.compile(r"\bInseratsnummer\s*:\s*([0-9]{1,20})\b", re.I)
DETAIL_LINK = re.compile(r"https?://suchen\.mobile\.de/fahrzeuge/details\.html\?\s*id\s*=\s*([0-9]{1,20})\b", re.I)
PRINT_LINK = re.compile(r"\bsuchen\.mobile\.de/fahrzeuge/printView\.html\?(?:[a-z_]+=[^\s&#]+&)*\s*id\s*=\s*([0-9]{1,20})\b", re.I)
PRICE = re.compile(
    r"(?<![\w.,])([0-9]+(?:[.\u00a0\u202f ][0-9]{3})*(?:,[0-9]{1,2})?)\s*(€|EUR(?!\w))", re.I)
NON_SALE = re.compile(r"\b(?:netto|zzgl|zuzüglich|exkl|ohne mwst|monatlich|monatsrate|rate|leasing|anzahlung|finanzierung|mtl|pro monat|ab)\b|/\s*monat", re.I)
GROSS = re.compile(r"\b(?:brutto|inkl\.?\s*(?:\d+(?:[,.]\d+)?\s*%\s*)?MwSt)", re.I)


def extract_pdf_text(data):
    if not isinstance(data, bytes) or len(data) > MAX_PDF_BYTES or not data.startswith(b"%PDF-"):
        raise DetailError("invalid_pdf", "Expected a PDF under 16 MB.")
    # Keep both the input and output bounded. Poppler reads a local file handle and
    # writes text to stdout. No hyperlinks, attachments or external commands are opened.
    with tempfile.TemporaryFile() as source:
        source.write(data)
        source.seek(0)
        try:
            process = subprocess.Popen(["pdftotext", "-layout", "-enc", "UTF-8", "-", "-"],
                                       stdin=source, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except FileNotFoundError:
            raise DetailError("missing_pdftotext", "PDF reading requires the free Poppler pdftotext executable.") from None
        with process, ThreadPoolExecutor(max_workers=1) as pool:
            try:
                output = pool.submit(process.stdout.read, MAX_PRINT_TEXT + 1).result(timeout=12)
                if len(output) > MAX_PRINT_TEXT:
                    raise DetailError("pdf_too_large", "Extracted PDF text exceeds 2 MB.")
                if process.wait(timeout=2):
                    raise DetailError("invalid_pdf", "The local PDF could not be read.")
            except (ReadTimeout, subprocess.TimeoutExpired):
                raise DetailError("pdf_timeout", "PDF text extraction timed out.") from None
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()
                process.stdout.close()
        text = output.decode("utf-8")
    if not text.strip():
        raise DetailError("no_text_layer", "The PDF contains no extractable text.")
    return text


def display_price(header):
    quoted = {"gross": [], "unmarked": []}
    for line in header:
        matches = list(PRICE.finditer(line))
        for i, match in enumerate(matches):
            # The PDF can put the tax or monthly qualifier in a different column.
            # A suffix belongs to the amount directly to its left.
            suffix = line[match.end():matches[i+1].start() if i+1 < len(matches) else None]
            prefix = line[:match.start()] if i == 0 else ""
            if NON_SALE.search(suffix) or NON_SALE.search(prefix):
                continue
            amount = parse_amount(match[1])
            if amount:
                key = "gross" if GROSS.search(suffix) or GROSS.search(prefix) else "unmarked"
                quoted[key].append(amount)
    return one(quoted["gross"] or quoted["unmarked"], "price")


def labelled_value(text, label, pattern, transform):
    matches = re.finditer(r"(?mi)^\s*" + label + r"[ \t]*:?[ \t]*(?:\n[ \t]*)?(" + pattern + r")(?=[ \t\r\n]|$)", text)
    return one([transform(x[1]) for x in matches], label)


def parse_print_text(text, source_url=None):
    references = DISPLAY_ID.findall(text)
    if len(references) > 1 or re.search(r"(?i)\bid\s*=\s*[0-9]+[^\s]*&(?:amp;)?id\s*=", text):
        raise DetailError("ambiguous_identity", "Multiple listing headers or duplicate native ID parameters.")
    number = one(references, "identity")
    # Column-aligned exports can print an amount at the right of the first
    # half of a wrapped URL. Join only a URL ending in ? to its id= continuation
    # in the first column of the next line.
    line_pairs = re.finditer(
        r"(https?://suchen\.mobile\.de/fahrzeuge/details\.html\?)[ \t]{2,}[^\n]*\n[ \t]*"
        r"(id=[0-9]{1,20})\b", text, re.I)
    links = DETAIL_LINK.findall(text)
    for pair in line_pairs:
        links.extend(DETAIL_LINK.findall(pair[1] + pair[2]))
    printed = one(links, "identity")
    if not number or not printed:
        raise DetailError("missing_native_identity", "Expected the printed listing number and full mobile.de detail link.")
    key = one([number, printed, *PRINT_LINK.findall(text)], "identity")
    source, _, url = listing_identity("https://suchen.mobile.de/fahrzeuge/details.html?id=" + key)
    if source_url and listing_identity(source_url)[:2] != (source, key):
        raise DetailError("ambiguous_identity", "The supplied and printed listing IDs differ.")
    first = text.split("\f", 1)[0].splitlines()
    id_index = next((i for i, line in enumerate(first) if DISPLAY_ID.search(line)), None)
    if id_index is None:
        raise DetailError("incomplete", "No listing header on the first page.")
    if BAD_SCREEN.search(" ".join(first[:id_index + 1])):
        raise DetailError("blocked_or_unavailable", "The print header shows a refusal or unavailable listing.")
    # The print template places the title immediately before the native reference.
    before = [line for line in first[:id_index] if line.strip()]
    title_parts = []
    if before:
        last = before[-1]
        title_parts = [cell for cell in re.split(r"\s{2,}", last.strip())
                       if not PRICE.search(cell) and not re.fullmatch(r"(?:Ohne|Faire?) Bewertung|(?:Guter|Fairer|Sehr guter) Preis", cell, re.I)]
        if len(title_parts) == 1 and NON_SALE.search(title_parts[0]) and "%" in title_parts[0]:
            title_parts = []
    title = compact(title_parts[0]) if len(title_parts) == 1 else ""
    if not title or len(title) > 240 or not any(c.isalpha() for c in title) or re.search(r"https?://|Deutschlands größter Fahrzeugmarkt|Druckansicht:|^id=",title,re.I):
        raise DetailError("incomplete", "Unverified vehicle title in print header.")
    # Only the offer header can supply the advertised amount; descriptions and financing tables are excluded.
    end = next((i for i in range(id_index + 1, len(first))
                if re.match(r"^\s*(?:Fahrzeugzustand|Kategorie|Kilometerstand|Erstzulassung|"
                            r"Technische Daten|Fahrzeugbeschreibung|Ausstattung)\b", first[i], re.I)),
               len(first))
    header = first[max(0, id_index-9):min(end, id_index+7)]
    amount = display_price(header)
    km = labelled_value(text, "Kilometerstand", r"[0-9]+(?:[. ,'’\u00a0\u202f][0-9]{3})*\s*km", kilometers)
    year = labelled_value(text, "Erstzulassung", r"(?:0?[1-9]|1[0-2])[/.-][0-9]{4}|[0-9]{4}", year_of)
    if amount is None or km is None or year is None:
        raise DetailError("incomplete", "Missing cash price in EUR, first-registration year or mileage in km.")
    return dict(source=source, source_id=key, source_url=url, title=title, price=amount,
                currency="EUR", year=year, mileage_km=km)


def parse_pdf(data, source_url=None):
    return parse_print_text(extract_pdf_text(data), source_url)
