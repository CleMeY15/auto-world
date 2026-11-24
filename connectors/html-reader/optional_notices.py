"""Recognize three incidental notices in already delivered HTML vehicle records."""
from html.parser import HTMLParser
import re
from xml.etree.ElementTree import TreeBuilder

from custom_detail import BAD_SCREEN, BLOCKS, VOID, compact, listing_identity, visible_fields


COOKIE = re.compile(r"(?:accept|accepter|zustimmen).{0,32}(?:cookies|continuer|continue|fortfahren)", re.I)
ACCEPT_COOKIES = re.compile(r"accepter (?:tous )?les cookies|accept (?:all )?cookies|(?:alle )?cookies akzeptieren", re.I)
DECLINE = re.compile(r"continuer sans accepter|tout refuser|refuser (?:tous )?les cookies|continue without accepting|reject all(?: cookies)?|decline (?:all )?cookies|alle ablehnen|nur notwendige cookies", re.I)
CONTACT = re.compile(r"contacter le vendeur|contact(?: the)? seller|kontakt zum verkäufer|verkäufer kontaktieren", re.I)
SEND = re.compile(r"envoyer(?: (?:le |un )?message)?|send(?: (?:a |the )?message)?|(?:nachricht )?senden", re.I)
CONTACT_MESSAGE = re.compile(r"formulaire de contact|contact form|kontaktformular|message|nachricht", re.I)
FOR_SENDING = re.compile(r"(?:pour (?:pouvoir )?envoyer (?:votre|un|le|ce) message|to send (?:your |a |the )?message|"
                         r"um (?:eine |die |ihre )?nachricht (?:zu )?(?:senden|verschicken))", re.I)
OVERLAY = re.compile(r"modal|backdrop|overlay", re.I)
ACCESS_NOTICE = re.compile(r"accéder|accès à (?:la|cette) page|zugang|(?:view|access|unlock) (?:the |this |your )?(?:site|listing|page)|unavailable|indisponible|nicht mehr verfügbar", re.I)
HELP = re.compile(r"\b(?:aide|help|hilfe|assistance)\b", re.I)
QUOTED_DENIAL = re.compile(r'[«“„"\']\s*access denied\s*[»”"“\']', re.I)
CAPTCHA = re.compile(r"\b(?:re|h)?captcha\b", re.I)
RISK_SOURCE = re.compile(r"captcha|challenge-platform|turnstile|challenge", re.I)
HIDDEN_STYLE = re.compile(r"(?:display:none|visibility:(?:hidden|collapse)|opacity:0(?:\.0+)?(?:[;!]|$))")
OMIT = {"script", "style", "template", "noscript", "iframe", "svg", "head"}


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.builder = TreeBuilder()
        self.root = self.builder.start("document", {})
        self.open = []
        self.nodes = 0

    def handle_starttag(self, tag, attrs):
        self.nodes += 1
        if self.nodes > 20000 or len(self.open) >= 80:
            raise ValueError("HTML shape exceeds the local inspection limits")
        self.builder.start(tag, {k: v or "" for k, v in attrs})
        if tag in VOID:
            self.builder.end(tag)
        else:
            self.open.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.open or self.open.pop() != tag:
            raise ValueError("Ambiguous HTML nesting")
        self.builder.end(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        self.builder.data(data)


def hidden(node):
    style = re.sub(r"\s+", "", node.get("style", "").lower())
    classes = node.get("class", "").lower().split()
    return ("hidden" in node.attrib or "inert" in node.attrib or node.get("aria-hidden", "").lower() == "true"
            or bool(HIDDEN_STYLE.search(style)) or bool({"hidden", "sr-only", "visually-hidden"} & set(classes)))


def read_text(node, skip=()):
    chunks = []

    def visit(el):
        if el in skip or el.tag in OMIT or hidden(el):
            return
        if el.tag in BLOCKS:
            chunks.append("\n")
        chunks.append(el.text or "")
        for child in el:
            visit(child)
            chunks.append(child.tail or "")
        if el.tag in BLOCKS:
            chunks.append("\n")

    visit(node)
    return [s for line in "".join(chunks).splitlines() if (s := compact(line))]


def optional_public_listing(html):
    """True only for a complete visible native listing with a narrowly localized notice."""
    # The generic challenge vocabulary is shared, without adding an import cycle at module load.
    from own_fetch import BLOCKED_TEXT

    def risky(text):
        return bool(BLOCKED_TEXT.search(text) or BAD_SCREEN.search(text) or COOKIE.search(text))

    if not isinstance(html, str) or len(html) > 4_000_000:
        return False
    try:
        page = Page()
        page.feed(html)
        page.close()
        if page.open:
            return False
        page.builder.end("document")
        root = page.builder.close()
        if any(el.tag == "dialog" or el.get("role", "").lower() in {"dialog", "alertdialog"}
               or el.get("aria-modal", "").lower() == "true" or "inert" in el.attrib
               or OVERLAY.search(el.get("class", "")+" "+el.get("id", ""))
               or re.search(r"position\s*:\s*fixed", el.get("style", ""), re.I)
               or (el.tag in {"script", "iframe", "object", "embed"} and
                   RISK_SOURCE.search(el.get("src", "")+" "+el.get("data", ""))) for el in root.iter()):
            return False
        links = [n.get("href") for n in root.iter("link") if "canonical" in n.get("rel", "").lower().split()]
        if len(links) != 1 or listing_identity(links[0])[0] != "mobile.de":
            return False
        mains, articles, h1s = (list(root.iter(tag)) for tag in ("main", "article", "h1"))
        if len(mains) > 1 or len(articles) > 1 or len(h1s) != 1:
            return False
        if mains and articles and articles[0] not in mains[0].iter():
            return False
        vehicle = next(iter(articles or mains), None)
        if vehicle is None or h1s[0] not in vehicle.iter():
            return False
        parents = {c: n for n in root.iter() for c in n}
        def accessible(node, *, actionable=False):
            while node is not None:
                if hidden(node) or node.tag in OMIT:
                    return False
                if actionable and ("disabled" in node.attrib or node.get("aria-disabled", "").lower() == "true"):
                    return False
                node = parents.get(node)
            return True

        if not accessible(h1s[0]):
            return False
        title = " ".join(read_text(h1s[0]))
        if not title or risky(title) or any(risky(" ".join(n.itertext())) for n in root.iter("title")):
            return False
        skip = set()
        for form in root.iter("form"):
            if not CONTACT.fullmatch(compact(form.get("aria-label", ""))):
                continue
            if not any(accessible(b, actionable=True) and SEND.fullmatch(" ".join(read_text(b)))
                       for b in form.iter("button")):
                continue
            for note in form.iter():
                if note.tag not in {"label", "p", "small"} or not accessible(note):
                    continue
                text = " ".join(read_text(note))
                # Ignore only a short notice that explicitly qualifies the send-message action.
                if (len(text) <= 220 and CAPTCHA.search(text) and FOR_SENDING.search(text)
                        and not ACCESS_NOTICE.search(text) and not risky(CAPTCHA.sub("", text))
                        and all(n.tag in {"label", "p", "small", "span", "strong", "em", "b", "i", "input"}
                                for n in note.iter())):
                    skip.add(note)
        for footer in root.iter("footer"):
            # Only the quoted words in a help paragraph may explain the previous generic match.
            for para in footer.iter("p"):
                text = " ".join(read_text(para))
                if (len(text) <= 300 and accessible(para) and HELP.search(text) and CONTACT_MESSAGE.search(text)
                        and QUOTED_DENIAL.search(text) and not ACCESS_NOTICE.search(text)
                        and not risky(QUOTED_DENIAL.sub("", text))
                        and all(n.tag in {"p", "span", "strong", "em", "b", "i", "a"} for n in para.iter())):
                    skip.add(para)
            buttons = [b for b in footer.iter("button") if accessible(b, actionable=True) and read_text(b)]
            if any(DECLINE.fullmatch(" ".join(read_text(b))) for b in buttons):
                skip.update(b for b in buttons if ACCEPT_COOKIES.fullmatch(" ".join(read_text(b))))

        if not skip:
            return False
        remaining = " ".join(read_text(root, skip))
        if risky(remaining) or ACCESS_NOTICE.search(remaining):
            return False
        fields = visible_fields(read_text(vehicle, skip))
        return all(fields.get(k) is not None for k in ("price", "currency", "year", "mileage_km"))
    except (AssertionError, ValueError):
        return False
