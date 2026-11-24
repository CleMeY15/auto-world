#!/usr/bin/env python3
"""One-shot, rate-limited Jina Reader test of public vehicle search-result pages.

Only redacted aggregate counts are persisted. No raw content or personal data.
No retry on refusals or technical errors.
"""
import argparse
import hashlib
import html
import json
import re
import time
import unicodedata
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

from jina_verification_diagnostic import diagnostics

CAP = 500
MAX_PAGES = 40
MIN_GAP_SECONDS = 12
MAX_SECONDS = 60 * 60
FETCH_TIMEOUT_SECONDS = 65
MAX_BYTES = 3_000_000
SEARCH = "https://www.leboncoin.fr/recherche?category=2&page="
CORE = re.compile(
    r"[·•]\s*(?P<year>19[5-9][0-9]|20[0-2][0-9])\s*[·•]\s*"
    r"(?P<km>[0-9][0-9 \u00a0\u202f.,]{0,13})\s*km\b", re.I
)
PRICE = re.compile(
    r"(?<!\d)(?P<price>[0-9]{1,3}(?:[ \u00a0\u202f.,][0-9]{3})+|[0-9]{3,7})\s*€", re.I
)
DIRECT_URL = re.compile(
    r"(?:https?://(?:www\.)?leboncoin\.fr)?/ad/voitures/(?P<id>[0-9]{8,12})(?![0-9])", re.I
)
INVALID_TITLE = re.compile(
    r"^(?:annonce|sponsoris|à la une|a la une|prix|pro|vendeur|pack|"
    r"image|ann[ée]e|kilom[ée]trage|[ée]nergie|bo[iî]te|"
    r"toute la france|situ[ée]e|paiement|baisse de prix|"
    r"d[èe]s|voir|acheter|filtres|carte|titre|mes recherches|favoris)\b", re.I
)
MONTHLY = re.compile(r"/\s*mois|\bpar mois\b|mensualit[ée]|(?:^|\bou\s+)d[èe]s\b|^à partir de\b", re.I)
PRICE_LABEL = re.compile(r"^prix\s*:\s*", re.I)
CARD_TITLE_LINK = re.compile(
    r"^\s*(?:#{1,6}\s+|[-*+]\s+)?(?:\*\*)?"
    r"\[(?P<title>[^\]\r\n]*)\]\("
    r"(?:https?://(?:www\.)?leboncoin\.fr)?/ad/voitures/(?P<id>[0-9]{8,12})"
    r"(?:[?#][^\s)]*)?\)(?:\*\*)?\s*$", re.I
)
GENERIC_LINK_LABEL = re.compile(
    r"^(?:d[ée]tails?|en savoir plus|consulter|photo|photos|"
    r"essence|diesel|hybride|[ée]lectrique|manuelle|automatique|"
    r"professionnel|particulier|occasion|neuf)$", re.I
)


def digest(value):
    return hashlib.sha256(value.encode("utf-8", "replace")).hexdigest()


def textline(line):
    line = html.unescape(line).strip()
    line = re.sub(r"^\s*[-*>\s#]+", "", line)
    line = re.sub(r"!\[[^]]*]\([^)]*\)", " ", line)
    line = re.sub(r"\[([^]]+)]\([^)]+\)", r"\1", line)
    line = line.strip(" *_#\t\r\n")
    return " ".join(line.split())


def normalize(s):
    s = unicodedata.normalize("NFKD", s).lower()
    return " ".join(s.split())


def price_eur(line):
    # A price must be a standalone amount (optionally explicitly labelled).
    # Do not mistake a monthly payment, fee, or text mentioning money for it.
    candidate = line.strip()
    if MONTHLY.search(candidate):
        return None
    candidate = PRICE_LABEL.sub("", candidate, count=1)
    m = PRICE.fullmatch(candidate.rstrip(".").strip())
    if not m:
        return None
    try:
        value = int(re.sub(r"\D", "", m.group("price")))
    except ValueError:
        return None
    return value if 100 <= value <= 5_000_000 else None


def plausible_title(candidate, *, linked=False):
    # Short models (C3, A3, Twingo, 208, etc.) require an explicit title link.
    # Unlinked text retains the original conservative multiword check.
    return bool(
        (2 if linked else 5) <= len(candidate) <= 240
        and (any(ch.isalpha() for ch in candidate) or (linked and candidate.isdecimal()))
        and not INVALID_TITLE.search(candidate)
        and not GENERIC_LINK_LABEL.fullmatch(candidate)
        and not MONTHLY.search(candidate)
        and not PRICE.search(candidate)
        and not candidate.startswith(("http", "【"))
        and (linked or len(candidate.split()) >= 2)
    )


def unique_sale_price(lines):
    matches = [(i, price_eur(textline(line))) for i, line in enumerate(lines)]
    matches = [(i, value) for i, value in matches if value is not None]
    if len({value for _, value in matches}) != 1:
        return None, None
    # Repeated copies of the same price are harmless; use the first.
    return matches[0]


def parse_page(body):
    """Return only in-memory card keys and quality indicators; no raw texts."""
    if not isinstance(body, str):
        raise TypeError("body must be text")
    body = html.unescape(body)
    cars = []
    previous_end = 0
    cores = list(CORE.finditer(body))
    for core in cores:
        start = max(previous_end, core.start() - 1800)
        prefix = body[start:core.start()]
        lines = prefix.splitlines()
        price = None
        title = ""
        linked_id = None
        anchors = []
        for index, line in enumerate(lines):
            link = CARD_TITLE_LINK.fullmatch(line)
            if link:
                anchors.append((index, link.group("id"), textline(link.group("title"))))
        if anchors:
            # If title links conflict, the card boundary is ambiguous.
            # Never borrow the previous card's price or substitute nearby text
            # for an empty/generic linked title.
            identities = {(ad_id, normalize(label)) for _, ad_id, label in anchors}
            if len(identities) == 1:
                index, linked_id, label = anchors[-1]
                if plausible_title(label, linked=True):
                    _, price = unique_sale_price(lines[index + 1:])
                    title = label
        else:
            price_idx, price = unique_sale_price(lines)
            if price_idx is not None:
                for line in reversed(lines[max(0, price_idx - 18):price_idx]):
                    candidate = textline(line)
                    if plausible_title(candidate):
                        title = candidate
                        break

        year = int(core.group("year"))
        km = int(re.sub(r"\D", "", core.group("km")))
        if km > 2_000_000:
            previous_end = core.end()
            continue

        local_link_ids = set(DIRECT_URL.findall(prefix[-1800:]))
        # Prefer an unambiguous title-linked ID; otherwise require one local ID.
        ad_id = linked_id if linked_id and linked_id in local_link_ids else (
            next(iter(local_link_ids)) if len(local_link_ids) == 1 else None
        )
        complete = bool(title and price is not None and year and km >= 0)
        if complete:
            fingerprint = digest("|".join((normalize(title), str(price), str(year), str(km))))
            key = "id:" + ad_id if ad_id else "fingerprint:" + fingerprint
            cars.append({"key": key, "linkable": bool(ad_id), "complete": True})
        else:
            cars.append({"key": None, "linkable": False, "complete": False})
        previous_end = core.end()

    return {
        "raw_vehicle_patterns": len(cores),
        "cards": cars,
        "direct_vehicle_links_in_page": len(set(DIRECT_URL.findall(body))),
    }


def fetch_page(page):
    source_url = SEARCH + str(page)
    req = urllib.request.Request(
        "https://r.jina.ai/" + source_url,
        headers={
            "Accept": "text/plain",
            "X-Respond-With": "markdown",
            "X-With-Links-Summary": "all",
            "User-Agent": "AutoFindex-Research-Jina-Listing-Experiment/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SECONDS) as response:
            return response.status, response.read(MAX_BYTES + 1).decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        return err.code, err.read(20_000).decode("utf-8", "replace")


def execute(fetcher=fetch_page, *, max_pages=MAX_PAGES, cap=CAP, gap=MIN_GAP_SECONDS):
    assert max_pages <= MAX_PAGES and cap <= CAP and gap >= MIN_GAP_SECONDS
    started = time.monotonic()
    last_sent_at = None
    seen = set()
    seen_page_hashes = set()
    totals = Counter()
    per_page = []
    reason = None
    no_growth = 0
    for page in range(1, max_pages + 1):
        if len(seen) >= cap:
            reason = "target_500_cards_reached"
            break
        if time.monotonic() - started > MAX_SECONDS:
            reason = "time_budget"
            break
        if last_sent_at is not None:
            wait = gap - (time.monotonic() - last_sent_at)
            if wait > 0:
                time.sleep(wait)
        last_sent_at = time.monotonic()
        t = time.monotonic()
        try:
            status, response = fetcher(page)
        except Exception as error:
            per_page.append({
                "page": page, "http_status": None,
                "outcome": "network_error",
                "exception_type": type(error).__name__,
                "duration_seconds": round(time.monotonic() - t, 2),
            })
            reason = "network_or_timeout_error"
            break
        totals["jina_requests"] += 1
        totals["http_" + str(status)] += 1
        if len(response) > MAX_BYTES:
            per_page.append({"page": page, "http_status": status, "outcome": "response_too_large"})
            reason = "response_size_limit"
            break
        if status in (403, 429, 401, 407):
            per_page.append({"page": page, "http_status": status, "outcome": "refused"})
            reason = "refused"
            break
        if status in (404, 410):
            per_page.append({"page": page, "http_status": status, "outcome": "no_more_pages"})
            reason = "no_more_pages"
            break
        if isinstance(status, int) and status >= 500:
            totals["server_errors"] += 1
            per_page.append({"page": page, "http_status": status, "outcome": "server_error"})
            if totals["server_errors"] >= 3:
                reason = "server_error_limit"
                break
            continue
        if status != 200:
            per_page.append({"page": page, "http_status": status, "outcome": "unexpected_http"})
            reason = "unexpected_http"
            break
        diagnosis = diagnostics(response, parse_page, status=status)
        if diagnosis["classification"] != "no_signal":
            per_page.append({
                "page": page,
                "http_status": status,
                "outcome": "verification_signal",
                "diagnosis": diagnosis,
            })
            print("AUTOFINDEX_JINA_VERIFICATION " + json.dumps(per_page[-1]), flush=True)
            # Do not proceed past a potential challenge, including generic keyword-only signals.
            reason = "verification_signal"
            break
        page_hash = digest(response)
        parsed = parse_page(response)
        cards = parsed["cards"]
        new_keys = [c["key"] for c in cards if c["complete"] and c["key"] not in seen]
        new_keys = list(dict.fromkeys(new_keys))
        new_count = min(len(new_keys), cap - len(seen))
        for key in new_keys[:new_count]:
            seen.add(key)
        totals["raw_vehicle_patterns"] += parsed["raw_vehicle_patterns"]
        totals["complete_cards_seen"] += sum(1 for c in cards if c["complete"])
        totals["unique_cards"] = len(seen)
        totals["pages_with_cards"] += bool(cards)
        totals["cards_without_four_fields"] += sum(1 for c in cards if not c["complete"])
        totals["cards_with_link_seen"] += sum(1 for c in cards if c["complete"] and c["linkable"])
        totals["direct_vehicle_links_observed"] += parsed["direct_vehicle_links_in_page"]
        if page_hash in seen_page_hashes:
            totals["identical_page_responses"] += 1
        seen_page_hashes.add(page_hash)
        no_growth = no_growth + 1 if new_count == 0 else 0
        per_page.append({
            "page": page, "http_status": status, "outcome": "parsed",
            "vehicle_patterns": parsed["raw_vehicle_patterns"],
            "complete_cards": sum(1 for c in cards if c["complete"]),
            "new_unique_cards": new_count,
            "direct_links_found": parsed["direct_vehicle_links_in_page"],
            "cards_with_attached_link": sum(1 for c in cards if c["complete"] and c["linkable"]),
            "duration_seconds": round(time.monotonic() - t, 2),
            "response_characters": len(response),
        })
        print("AUTOFINDEX_JINA_LIST_PAGE " + json.dumps(per_page[-1]), flush=True)
        if not cards and page == 1:
            reason = "no_cards_on_first_page"
            break
        if no_growth >= 2:
            reason = "no_new_cards_on_two_pages"
            break
        if len(seen) >= cap:
            reason = "target_500_cards_reached"
            break
    else:
        reason = "maximum_pages_reached"
    return {
        "schema_version": "autofindex-jina-search-pages/v1",
        "goal_unique_search_cards": cap,
        "maximum_pages": max_pages,
        "minimum_interval_seconds": gap,
        "total_requests": totals["jina_requests"],
        "unique_search_cards_estimated": totals["unique_cards"],
        "complete_search_cards_seen_including_repeats": totals["complete_cards_seen"],
        "partial_search_cards_seen": totals["cards_without_four_fields"],
        "total_vehicle_patterns": totals["raw_vehicle_patterns"],
        "pages_with_cars": totals["pages_with_cards"],
        "cards_with_link_seen_including_repeats": totals["cards_with_link_seen"],
        "vehicle_links_observed_in_page_content": totals["direct_vehicle_links_observed"],
        "identical_page_responses": totals["identical_page_responses"],
        "http_status_counts": {k[5:]: v for k, v in totals.items() if k.startswith("http_")},
        "stop_reason": reason,
        "duration_seconds": round(time.monotonic() - started, 2),
        "unique_cards_method": "public_ad_url_if_single_locally_or_fingerprint_of_title_price_year_kilometers",
        "cards_are_verified_distinct_ad_ids": False,
        "detail_pages_fetched": 0,
        "source_access_approved": False,
        "database_updated": False,
        "raw_content_stored": False,
        "per_page": per_page,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = execute()
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True)
    (output / "jina-search-pages.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        "AUTOFINDEX_JINA_LIST_BENCH " +
        json.dumps({k: v for k, v in result.items() if k != "per_page"}, ensure_ascii=False),
        flush=True,
    )


if __name__ == "__main__":
    main()
