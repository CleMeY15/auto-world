"""Normalize one locally supplied, visible vehicle detail page. No network I/O."""
from datetime import date
from decimal import Decimal
from html.parser import HTMLParser
import json
import re
from urllib.parse import parse_qs, urlsplit, urlunsplit


MAX_BYTES = 8_000_000
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
AS_DOMAINS = {"autoscout24." + t for t in ("fr", "de", "be", "nl", "it", "at", "es", "lu", "com", "pl", "ch")}
BLOCKS = set("address article aside blockquote br dd div dl dt footer h1 h2 h3 header hr li main p section table td th tr ul".split())
VOID = set("area base br col embed hr img input link meta param source track wbr".split())
SKIP = set("style template noscript svg iframe".split())


class DetailError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def compact(value):
    return " ".join(str(value).split()) if value is not None else ""


def listing_identity(value):
    try:
        if not isinstance(value, str) or len(value) > 4096 or re.search(r"[\s\\\x00-\x1f]", value):
            raise ValueError()
        u = urlsplit(value)
        h = u.hostname or ""
        if u.scheme != "https" or u.username is not None or u.password is not None or u.port not in (None, 443):
            raise ValueError()
        path = u.path
        query = ""
        if h in {"mobile.de", "www.mobile.de", "suchen.mobile.de", "m.mobile.de"}:
            site = "mobile.de"
            if path == "/fahrzeuge/details.html":
                ids = parse_qs(u.query, keep_blank_values=True).get("id", [])
                if len(ids) != 1 or not re.fullmatch(r"[0-9]{1,20}", ids[0]):
                    raise ValueError()
                key = ids[0]
                query = "id=" + key
            else:
                key = re.fullmatch(r"/auto-inserat/[^/]+/([0-9]{1,20})\.html", path).group(1)
        elif h.removeprefix("www.") in AS_DOMAINS:
            site = "AutoScout24"
            key = re.fullmatch(r"/(?:offres|angebote|annunci|ofertas|aanbod|offers|oferty)/"
                               r"(?:[^/]+-)?(" + UUID + r")/?", path, re.I).group(1).lower()
        else:
            raise ValueError()
        return site, key, urlunsplit(("https", h, path, query, ""))
    except (ValueError, AttributeError, UnicodeError):
        raise DetailError("unsupported_url", "Expected an HTTPS individual vehicle listing with its native ID.") from None


class DetailHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.frames = []
        self.urls = []
        self.scripts = []
        self.titles = []
        self.headings = []
        self.visible = []
        self.ld = None
        self.heading = None
        self.title = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        parent_hidden = bool(self.frames and self.frames[-1][1])
        hidden = parent_hidden or tag in SKIP or "hidden" in attrs or attrs.get("aria-hidden") == "true"
        if tag == "script" and not parent_hidden and (attrs.get("type") or "").lower().split(";")[0].strip() == "application/ld+json":
            self.ld = []
        if not hidden:
            if tag == "link" and "canonical" in (attrs.get("rel") or "").lower().split() and attrs.get("href"):
                self.urls.append(attrs["href"])
            if tag == "meta" and attrs.get("property") == "og:url" and attrs.get("content"):
                self.urls.append(attrs["content"])
            if tag == "h1":
                self.heading = []
            if tag == "title":
                self.title = []
            if tag in BLOCKS:
                self.visible.append("\n")
        if tag not in VOID:
            self.frames.append((tag, hidden or tag in {"script", "title"}))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag == "script" and self.ld is not None:
            self.scripts.append("".join(self.ld))
            self.ld = None
        if tag == "h1" and self.heading is not None:
            self.headings.append(compact(" ".join(self.heading)))
            self.heading = None
        if tag == "title" and self.title is not None:
            self.titles.append(compact(" ".join(self.title)))
            self.title = None
        for i in range(len(self.frames) - 1, -1, -1):
            if self.frames[i][0] == tag:
                del self.frames[i:]
                break
        if tag in BLOCKS:
            self.visible.append("\n")

    def handle_data(self, data):
        if self.ld is not None:
            self.ld.append(data)
        elif self.title is not None:
            self.title.append(data)
        elif not self.frames or not self.frames[-1][1]:
            self.visible.append(data)
            if self.heading is not None:
                self.heading.append(data)


def one(values, name):
    present = {v for v in values if v is not None and v != ""}
    if len(present) > 1:
        raise DetailError("ambiguous_" + name, "Conflicting values for " + name + ".")
    return next(iter(present), None)


def object_types(node):
    names = node.get("@type", [])
    if not isinstance(names, list):
        names = [names]
    return {x.rsplit("/", 1)[-1] for x in names if isinstance(x, str)}


def structured(documents):
    nodes = []
    stack = list(documents)
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
        elif isinstance(node, dict):
            nodes.append(node)
            for key in ("@graph", "mainEntity"):
                stack.append(node.get(key))
    index = {x["@id"]: x for x in nodes if isinstance(x.get("@id"), str) and len(x) > 1}

    def resolve(node):
        if isinstance(node, dict) and set(node) == {"@id"}:
            return index.get(node["@id"], node)
        return node

    candidates = [x for x in nodes if object_types(x) & {"Car", "Vehicle", "Product", "IndividualProduct"}]
    return candidates, resolve, any("ItemList" in object_types(x) or "SearchResultsPage" in object_types(x) for x in nodes)


def parse_amount(value, *, structured_price=False):
    if isinstance(value, bool):
        return None
    s = compact(value).replace(" ", "").replace("’", "").replace("'", "")
    s = re.sub(r"[,\.]–$|[,\.]-$", "", s)
    if not s or re.search(r"[^\d.,]", s):
        return None
    if structured_price and re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,2})?", s):
        return format(Decimal(s), ".2f") if Decimal(s) > 0 else None
    if re.fullmatch(r"[0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{1,2})?", s):
        s = s.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?", s):
        s = s.replace(",", "")
    elif re.fullmatch(r"[0-9]{1,12}(?:[,.][0-9]{1,2})?", s):
        s = s.replace(",", ".")
    else:
        return None
    if len(s) > 15:
        return None
    value = Decimal(s)
    return format(value, ".2f") if value > 0 else None


def year_of(value):
    value = compact(value)
    match = re.fullmatch(r"(?:0?[1-9]|1[0-2])[/.-]([0-9]{4})|([0-9]{4})(?:[-/](?:0[1-9]|1[0-2])(?:-\d{2})?)?", value)
    if match:
        n = int(match[1] or match[2])
        return n if 1886 <= n <= date.today().year + 1 else None


def kilometers(value):
    s = re.sub(r"\s*(?:kilom[eè]tres?|kilometers?|km)\.?$", "", compact(value), flags=re.I)
    if re.fullmatch(r"[0-9]{1,9}|[0-9]{1,3}(?:([., '\u2019])[0-9]{3})(?:\1[0-9]{3})?", s):
        return int(re.sub(r"[^0-9]", "", s))


PRICE_LABEL = r"prix(?: de vente| comptant| TTC)?|kaufpreis|barpreis|bruttopreis|preis|cash price|asking price|price|prezzo|precio|prijs"
KM_LABEL = r"kilom[eé]trage|kilometerstand|laufleistung|kilométrage au compteur|kilométrage du véhicule|mileage|chilometraggio|kilometraje"
YEAR_LABEL = r"premi[eè]re (?:immatriculation|mise en circulation)|(?:1(?:ère|re) )immatriculation|erstzulassung(?: \(EZ\))?|EZ|first registration|prima immatricolazione|primera matriculación|eerste inschrijving|année"
CUR = r"(?:€|EUR|CHF|GBP|£|USD|\$)"
MONEY = re.compile(r"(?:(?P<pre>" + CUR + r")\s*(?P<a>[0-9][0-9.,'’\s]*(?:[-–])?)|"
                   r"(?P<b>[0-9][0-9.,'’\s]*(?:[-–])?)\s*(?P<post>" + CUR + r"))"
                   r"(?:\s*\(?(?:TTC|Brutto|inkl\.?\s*(?:(?:\d{1,2}(?:[.,]\d+)?\s*%)\s*)?MwSt\.?|MwSt\.? ausweisbar)\)?)?", re.I)
BAD_SCREEN = re.compile(r"(?:^|\b)(?:access denied|request blocked|403 forbidden|429 too many requests|verify (?:that )?you are human|checking your browser|please verify you are human|vous [êe]tes (?:un )?humain|zugriff verweigert|bestätigen sie, dass sie ein mensch sind|just a moment|diese anzeige ist nicht mehr|cette annonce n.est plus disponible|this (?:ad|listing) is no longer available)", re.I)
LIST_HEADING = re.compile(r"^(?:search results|suchergebnisse|résultats de (?:la )?recherche|annonces trouvées|voitures (?:d.occasion|disponibles)|\d[\d., ]* (?:offres|résultats|angebote|treffer|annonces|results)\b)", re.I)


def money(s):
    s = re.sub(r"\s*\^\{[0-9]{0,2}\}$", "", s)
    m = MONEY.fullmatch(s)
    if m:
        amount = parse_amount(m["a"] or m["b"])
        unit = (m["pre"] or m["post"]).upper()
        unit = {"€": "EUR", "£": "GBP", "$": None}.get(unit, unit)
        if amount and unit:
            return amount, unit


def visible_values(lines, labels):
    for i, text in enumerate(lines):
        if re.fullmatch(r"(?:" + labels + r")\s*[:|]?", text, re.I):
            if i+1 < len(lines):
                yield i+1, lines[i+1]
            continue
        match = re.fullmatch(r"(?:" + labels + r")(?:\s*[:|]\s*|\s+)(.+)", text, re.I)
        if match:
            yield i, match[1].strip()


EXCLUDED_PRICE = re.compile(r"\b(?:netto|net|zzgl|zuzüglich|exkl|HT|hors taxes|mensualité|mensuel|monthly|monatsrate|monatlich|finanzierung|leasing|acompte|down payment)\b|/(?:mois|monat|month)", re.I)
PRICE_SUFFIX = re.compile(r"^(?:HT|netto|zzgl|zuzüglich|exkl|hors taxes|par mois|per month|monatlich)\b|^/(?:mois|monat|month)\b", re.I)


def visible_fields(lines):
    def cash_price(i, value):
        if EXCLUDED_PRICE.search(value) or (i+1 < len(lines) and PRICE_SUFFIX.search(lines[i+1])):
            return None
        return money(value)

    prices = [cash_price(i, s) for i, s in visible_values(lines, PRICE_LABEL)]
    if not any(prices):
        prices = [cash_price(i, line) for i, line in enumerate(lines)
                  if not i or not EXCLUDED_PRICE.search(lines[i-1])]
    price = one(prices, "price")
    yrs = [year_of(v) for _, v in visible_values(lines, YEAR_LABEL)]
    km = [kilometers(v) for _, v in visible_values(lines, KM_LABEL)]
    return {"price": price[0] if price else None, "currency": price[1] if price else None,
            "year": one(yrs, "year"), "mileage_km": one(km, "mileage_km")}


def candidate_url(node):
    values = [node.get("url"), node.get("mainEntityOfPage")]
    if isinstance(node.get("@id"), str) and node["@id"].startswith("https://"):
        values.append(node["@id"])
    return [v if isinstance(v, str) else v.get("@id") for v in values
            if isinstance(v, str) or isinstance(v, dict) and isinstance(v.get("@id"), str)]


def semantic_fields(node, resolve):
    offers = node.get("offers", [])
    offers = offers if isinstance(offers, list) else [offers]
    pairs = []
    for offer in map(resolve, offers):
        if not isinstance(offer, dict) or object_types(offer) - {"Offer"}:
            continue
        spec = resolve(offer.get("priceSpecification"))
        if isinstance(spec, list):
            continue
        spec = spec if isinstance(spec, dict) else {}
        if any(str(o.get("valueAddedTaxIncluded", "")).lower() == "false" for o in (offer, spec)):
            continue
        if any(o.get("billingDuration") or o.get("billingIncrement") or
               "lease" in str(o.get("businessFunction", "")).lower() for o in (offer, spec)):
            continue
        price = parse_amount(offer.get("price", spec.get("price")), structured_price=True)
        currency = compact(offer.get("priceCurrency", spec.get("priceCurrency"))).upper()
        if price and re.fullmatch(r"[A-Z]{3}", currency):
            pairs.append((price, currency))
    price = one(pairs, "price")
    km = resolve(node.get("mileageFromOdometer"))
    distance = None
    if isinstance(km, dict):
        unit = compact(km.get("unitCode") or km.get("unitText")).lower()
        if unit in {"kmt", "km", "kilometer", "kilometre", "kilometers", "kilomètres", "kilometres"}:
            distance = kilometers(km.get("value"))
    return {"title": compact(node.get("name")) if isinstance(node.get("name"), str) else None,
            "price": price[0] if price else None, "currency": price[1] if price else None,
            "year": year_of(node.get("dateVehicleFirstRegistered")), "mileage_km": distance}


def text_title(lines, site):
    # A bare Markdown level-one heading may span the model and a trim line.
    choices = []
    for i, line in enumerate(lines):
        if line == "#":
            parts = []
            for part in lines[i+1:i+3]:
                if not part or part.startswith(("【", "[", "#", "http")) or money(part):
                    break
                parts.append(part)
            if parts:
                choices.append(" ".join(parts))
        # The German detail header places the model between the call button
        # and the repeated cash price. Restrict this fallback to that layout.
        if (site == "mobile.de" and line == "Anrufen" and i+2 < len(lines)
                and money(lines[i+2]) and not lines[i+1].startswith(("【", "[", "#"))):
            choices.append(lines[i+1])
    title = one(choices, "title")
    if title:
        return title
    # A short, manually copied ficha can begin with its vehicle title. Require
    # a financial or technical field directly underneath to exclude navigation.
    body = [l for l in lines if not re.match(r"^(?:https?://|URL(?: Source)?\s*:)", l, re.I)]
    if (len(body) >= 2 and 2 < len(body[0]) < 170 and not body[0].startswith(("【", "[", "#"))
            and re.search(r"[A-Za-zÀ-ž]", body[0]) and
            (money(body[1]) or re.match(r"^(?:" + PRICE_LABEL + "|" + KM_LABEL + "|" + YEAR_LABEL + r")\b", body[1], re.I))):
        return body[0]


def parse_detail(content, source_url=None, *, format="html"):
    """Return eight normalized fields, or raise DetailError with a stable reason code."""
    if not isinstance(content, (str, bytes)) or not content or len(content) > MAX_BYTES:
        raise DetailError("invalid_input", "Supply a non-empty saved page up to 8 MB.")
    try:
        if isinstance(content, bytes):
            content = content.decode("utf-8-sig")
        if len(content.encode("utf-8")) > MAX_BYTES or "\x00" in content:
            raise ValueError()
    except (UnicodeError, ValueError):
        raise DetailError("invalid_input", "Expected UTF-8 text up to 8 MB.") from None
    docs, urls, headings, titles = [], [], [], []
    if format == "html":
        parser = DetailHTML()
        try:
            parser.feed(content)
            parser.close()
        except (ValueError, AssertionError):
            raise DetailError("invalid_html", "Could not parse the HTML document.") from None
        urls, headings, titles = parser.urls, parser.headings, parser.titles
        text = "".join(parser.visible)
        for script in parser.scripts:
            try:
                docs.append(json.loads(script))
            except (ValueError, RecursionError):
                continue
    elif format == "text":
        text = content
        for line in text.splitlines():
            label = re.fullmatch(r"(?:URL(?: Source)?\s*:\s*)?(https://\S+)", line.strip(), re.I)
            if label:
                urls.append(label[1])
            title = re.fullmatch(r"(?:#\s+|(?:Titre|Title|Titel)\s*:\s*)(.+)", line.strip(), re.I)
            if title:
                headings.append(compact(title[1]))
    else:
        raise DetailError("invalid_format", "Format must be html or text.")
    lines = []
    for raw_line in text.splitlines():
        line = compact(raw_line).strip("|").strip()
        line = re.sub(r"^[*-]\s+", "", line)
        line = re.sub(r"^\*\*(.+)\*\*$", r"\1", line)
        if line:
            lines.append(line)
    lines = [re.sub(r"^#{2,6}\s+", "", line) for line in lines]
    candidates, resolve, is_list = structured(docs)
    if (BAD_SCREEN.search(" ".join(titles + headings + lines[:14]))
            or any(t.casefold().strip(" .!") in {"captcha", "vérification de sécurité", "sicherheitsüberprüfung", "security check"} for t in titles + headings + lines[:4])):
        raise DetailError("blocked_or_unavailable", "This document shows a verification or unavailable page.")
    if is_list or any(LIST_HEADING.search(t) for t in titles + headings + lines[:3]):
        raise DetailError("list_page", "This document describes search results or a list.")
    if source_url is not None:
        urls.insert(0, source_url)
    if not urls:
        urls = [u for c in candidates for u in candidate_url(c)]
    if not urls:
        raise DetailError("missing_url", "A native listing URL is required.")
    identities = [listing_identity(url) for url in urls]
    one([t[:2] for t in identities], "identity")
    site, key, url = identities[0]
    if len(candidates) > 1:
        raise DetailError("ambiguous_listing", "Several vehicle entities appear on this page.")
    data = dict.fromkeys(("title", "price", "currency", "year", "mileage_km"))
    if candidates:
        candidate = candidates[0]
        for candidate_link in candidate_url(candidate):
            if listing_identity(candidate_link)[:2] != (site, key):
                raise DetailError("ambiguous_identity", "The vehicle and page identify different listings.")
        data.update(semantic_fields(candidate, resolve))
    if not data["title"]:
        title = one(headings, "title")
        if not title and format == "text":
            title = text_title(lines, site)
        data["title"] = title
    visible = visible_fields(lines)
    for k, v in visible.items():
        data[k] = one([v, data[k]], k)
    missing = [k for k, v in data.items() if v is None or v == ""]
    if missing:
        raise DetailError("incomplete", "Missing or unverified fields: " + ", ".join(missing) + ".")
    return {"source": site, "source_id": key, "source_url": url, **data}
