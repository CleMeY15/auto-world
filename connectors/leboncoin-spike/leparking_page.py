"""Parse one saved French Le Parking Markdown result page, entirely offline."""
import html
import re
from datetime import date
from urllib.parse import urljoin, urlsplit, urlunsplit

DEFAULT_PAGE = "https://www.leparking.fr/voiture-occasion/"
HOSTS = {"leparking.fr", "www.leparking.fr"}
NUMBER = r"(?:[0-9]{1,3}(?:[ .\u00a0\u202f][0-9]{3}){1,3}|[0-9]{1,12})"
PRICE = re.compile(rf"(?:prix\s*:\s*)?({NUMBER})\s*€", re.I)
KM = re.compile(rf"({NUMBER})\s*km", re.I)
YEAR = re.compile(r"[12][0-9]{3}")
HEADING = re.compile(r"^\s*(?:[-*+]\s+)?#{1,6}(?:\s+(.*)|\s*)$")
LINK = re.compile(r"\]\(<?([^\s<>()]+)>?(?:\s+[\"'][^\"']*[\"'])?\)")
PHOTO = re.compile(r"!\[([^\]\n]+)\]\(")
LABEL = re.compile(r"^\[([^\]]+)\]\(")
DIRECT = re.compile(r"/voiture-occasion-detail/(?:[^/?#]+/)+([A-Z0-9]{8})\.html")
TRACK = re.compile(r"/tools/([A-Z0-9]{8})/0/([TD])/P\.html")
EMPTY = re.compile(r"^(?:aucun(?:e)? (?:résultat|annonce)(?: (?:trouvé|trouvée|trouvés|trouvées))?|0 (?:résultat[s]?|annonce[s]?))[.!]?$", re.I)
PROTECTION = re.compile(r"verify (?:that )?you are human|vérifi(?:ez|er) que vous êtes humain|access denied|confirmez que vous êtes un humain", re.I)
NON_PRICE_PREFIX = re.compile(r"(?:[àa] partir de|dès|(?:ancien prix|prix (?:initial|précédent))\s*:?)", re.I)
FOOTER = "Que devons-nous faire avec cette annonce"


def ad_link(href, page_url):
    """Use only a publication identity and a link actually printed on this page."""
    try:
        url = urlsplit(urljoin(page_url, html.unescape(href)))
        if (url.scheme not in {"http", "https"} or url.hostname not in HOSTS
                or url.username is not None or url.password is not None or url.port):
            return None
    except ValueError:
        return None
    direct = DIRECT.fullmatch(url.path)
    tracking = TRACK.fullmatch(url.path)
    if not direct and not tracking:
        return None
    match = direct or tracking
    kind = "detail" if direct else "redirect"
    rank = 0 if direct else {"D": 1, "T": 2}[tracking[2]]
    return match[1], rank, kind, urlunsplit((url.scheme, url.netloc, url.path, "", ""))


def clean(line):
    line = re.sub(r"^[-*+]\s+", "", line.strip())
    return " ".join(html.unescape(line).strip(" *_").split())


def single(values):
    return next(iter(values)) if len(values) == 1 else None


def to_int(value):
    return int(re.sub(r"\D", "", value))


def card(title, lines, page_url):
    links = []
    photos = []
    for raw in [title, *lines]:
        for hit in LINK.finditer(raw):
            link = ad_link(hit[1], page_url)
            if link:
                links.append(link)
                photo = PHOTO.search(raw)
                if photo:
                    caption = re.sub(r"^Image\s+\d+\s*:\s*", "", photo[1], flags=re.I)
                    if caption.lower() not in {"camera_icon", "photo", "image"}:
                        photos.append(caption)
    if not links:
        return None, {}, set()
    ids = {link[0] for link in links}
    if len(ids) != 1:
        return None, {}, ids
    identity, _, kind, url = min(links, key=lambda link: link[1])
    label = LABEL.match(title)
    text = clean(label[1] if label else title)
    source = "heading" if text else "image_alt" if photos else None
    text = text or next(iter(photos), None)

    fields = [clean(line) for line in lines if line.strip()]
    prices, mileages, years = set(), set(), set()
    for i, value in enumerate(fields):
        amount = PRICE.fullmatch(value)
        before = fields[i-1] if i else ""
        after = fields[i+1] if i+1 < len(fields) else ""
        if (amount and not NON_PRICE_PREFIX.fullmatch(before)
                and not re.match(r"^(?:/|par\s+)\s*mois\b", after, re.I)):
            price = to_int(amount[1])
            if price > 0:
                prices.add(price)
        mileage = KM.fullmatch(value)
        if mileage:
            mileages.add(to_int(mileage[1]))
        # The site places the model year directly after mileage in the vehicle
        # facts. A four-digit postcode may also fall inside the valid year range.
        labeled_year = re.fullmatch(r"(?:ann[ée]e|mill[ée]sime)\s*:\s*([0-9]{4})", value, re.I)
        year = labeled_year[1] if labeled_year else value if KM.fullmatch(before) else ""
        if YEAR.fullmatch(year) and 1886 <= int(year) <= date.today().year + 1:
            years.add(int(year))
    # A compact teaser may precede the full linked heading in converted HTML.
    # The full card has the linked heading, detail link or vehicle attributes.
    has_detail = any(re.search(r"\[d[ée]tail\]\(", raw, re.I) for raw in lines)
    if not (label or has_detail or years or mileages):
        return None, {}, set()
    row = dict(key="leparking:" + identity, source_id=identity, url=url, url_kind=kind, title=text,
               title_source=source, price_eur=single(prices), year=single(years),
               mileage_km=single(mileages))
    row["complete"] = all(row[k] is not None for k in ("title", "price_eur", "year", "mileage_km"))
    evidence = {"title": {text} if source == "heading" else set(),
                "title_image_alt": {text} if source == "image_alt" else set(),
                "price_eur": prices, "year": years, "mileage_km": mileages}
    return row, evidence, set()


def parse_page(body, page_url=DEFAULT_PAGE):
    """Return distinct cards and evidence; never assemble a card from fragments.

    observed_values is keyed by the printed source ID. Its title field contains
    heading evidence only. Image-alt fallback titles are recorded separately.
    """
    if not isinstance(body, str):
        raise TypeError("body must be text")
    lines = html.unescape(body).splitlines()
    groups = []
    active = None
    for i, line in enumerate(lines):
        if clean(line).lstrip("#> *_-").casefold().startswith(FOOTER.casefold()):
            break
        head = HEADING.match(line)
        blank_card = line.strip() in {"*", "-", "+"} and (
            next((v.strip() for v in lines[i+1:i+5] if v.strip()), "") in {"Particulier", "Professionnel"}
        )
        if head or blank_card:
            active = ((head[1] or "").strip() if head else "", [])
            groups.append(active)
        elif active is not None:
            active[1].append(line)

    rows = {}
    seen_values = {}
    conflict_ids = set()
    observations = duplicates = conflicting_duplicates = ambiguous = 0
    for title, group in groups:
        row, evidence, ambiguous_ids = card(title, group, page_url)
        if not row:
            if ambiguous_ids:
                ambiguous += 1
                conflict_ids.update(ambiguous_ids)
            continue
        observations += 1
        identity = row["source_id"]
        known = seen_values.setdefault(identity, {k: set() for k in evidence})
        for field, values in evidence.items():
            known[field].update(values)
        # Image alt text can describe a version instead of the heading. Keep
        # it as provenance; never compare it with a title.
        has_conflict = len({v.casefold() for v in known["title"]}) > 1 or any(
            len(known[k]) > 1 for k in ("price_eur", "year", "mileage_km")
        )
        if has_conflict:
            if identity in rows:
                conflicting_duplicates += 1
            conflict_ids.add(identity)
        if identity in rows:
            duplicates += 1
            if rows[identity]["complete"] or not row["complete"]:
                continue
        rows[identity] = row
    for identity in conflict_ids:
        rows.pop(identity, None)
    if observations:
        status = "results"
    elif any(EMPTY.fullmatch(clean(line)) for line in lines):
        status = "empty_results"
    elif PROTECTION.search(body):
        status = "verification_signal"
    elif re.search(r"\bcaptcha\b", body, re.I):
        status = "verification_mention"
    else:
        status = "unrecognized"
    return dict(status=status, cards=list(rows.values()), observations=observations,
                duplicates=duplicates, conflicting_duplicates=conflicting_duplicates, conflict_ids=sorted(conflict_ids),
                ambiguous_cards=ambiguous,
                observed_values={identifier: {k: sorted(v) for k, v in fields.items()}
                                 for identifier, fields in seen_values.items()},
                complete=sum(row["complete"] for row in rows.values()))
