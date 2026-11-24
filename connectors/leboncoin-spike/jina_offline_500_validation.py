#!/usr/bin/env python3
"""Offline quality benchmark for the existing listing parser.

The 500 records below are wholly synthetic. No URL is fetched. All mock
responses are generated in memory, and only aggregate quality counts persist.
"""
import argparse
import hashlib
import importlib.util
import json
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from unittest.mock import patch
import urllib.request

source = Path(__file__).with_name("jina-list-benchmark.py")
spec = importlib.util.spec_from_file_location("jina_list_benchmark", source)
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)

MODELS = ["Peugeot 208", "Renault Clio", "Citroën C3", "Toyota Yaris",
          "Volkswagen Golf", "Ford Focus", "BMW Série 1", "Audi A3",
          "Dacia Sandero", "Kia Ceed"]
VARIANTS = ("standard", "unicode_spacing", "monthly_payment", "label_only_price", "one_word_title")
FIELDS = ("title", "price", "year", "mileage")


def truth(i):
    variant = VARIANTS[i % len(VARIANTS)]
    title = MODELS[i % len(MODELS)] + " finition test " + str(i + 1)
    if variant == "one_word_title":
        title = "Twingo"
    return {"id": str(900000000000 + i), "title": title,
            "price": 3250 + i * 197, "year": 2008 + i % 18,
            "mileage": i * 503, "variant": variant}


def fmt(num, sep):
    return f"{num:,}".replace(",", sep)


def render(row, clean=False):
    """Generate an illustrative Markdown card with a fictitious URL shape."""
    variant = "standard" if clean else row["variant"]
    title = row["title"]
    if clean and variant == "standard" and len(title.split()) == 1:
        title += " finition test"
    sep = "\u202f" if variant == "unicode_spacing" else " "
    dot = "•" if variant == "unicode_spacing" else "·"
    price = fmt(row["price"], sep) + " €"
    if variant == "label_only_price":
        price = "Prix: " + price
    lines = [f"### [{title}](https://www.leboncoin.fr/ad/voitures/{row['id']})", price]
    if variant == "monthly_payment":
        lines.append("Dès 250 €/mois")
    lines.append(f"{dot}{row['year']}{dot}{fmt(row['mileage'], sep)} km{dot}Essence{dot}Manuelle")
    return "\n".join(lines)


def normal(s):
    return " ".join(unicodedata.normalize("NFKD", str(s)).lower().split())


def expected_fields(row):
    return (normal(row["title"]), str(row["price"]), str(row["year"]), str(row["mileage"]))


def inspect_parsed(body):
    # The existing parser hashes the four normalized fields even for cards
    # with IDs. Capture only those pre-hash values in memory for exact comparison.
    captured = []
    real_digest = parser.digest
    def spy(value):
        captured.append(value)
        return real_digest(value)
    with patch.object(parser, "digest", side_effect=spy):
        result = parser.parse_page(body)
    complete = [card for card in result["cards"] if card["complete"]]
    if len(complete) != len(captured):
        raise AssertionError("Parser fingerprint instrumentation contract changed")
    return result, [(card, tuple(value.split("|"))) for card, value in zip(complete, captured)]


def score_single(records):
    totals = Counter()
    variants = defaultdict(Counter)
    for row in records:
        result, entries = inspect_parsed(render(row))
        group = variants[row["variant"]]
        totals["tested"] += 1
        group["tested"] += 1
        if len(entries) != 1:
            totals["missing_or_multiple_complete"] += 1
            group["missing_or_multiple_complete"] += 1
            continue
        card, fields = entries[0]
        totals["complete"] += 1
        group["complete"] += 1
        correct = [a == b for a, b in zip(fields, expected_fields(row))]
        for field, ok in zip(FIELDS, correct):
            if ok:
                totals[field + "_exact"] += 1
                group[field + "_exact"] += 1
        if card["key"] == "id:" + row["id"]:
            totals["id_exact"] += 1
            group["id_exact"] += 1
        if len(fields) == 4 and all(correct) and card["key"] == "id:" + row["id"]:
            totals["all_fields_and_id_exact"] += 1
            group["all_fields_and_id_exact"] += 1
    return dict(totals), {name: dict(variants[name]) for name in VARIANTS}


def pages(records, clean=False):
    # 40 per page and five overlapping records (e.g. changed ranking).
    output = []
    start = 0
    while start < len(records):
        group = records[start:start + 40]
        output.append("\n\n".join(render(row, clean=clean) for row in group))
        if start + 40 >= len(records):
            break
        start += 35
    return output


def simulate(pages_in, cap=500):
    calls = []
    def fetch(index):
        calls.append(index)
        if index <= len(pages_in):
            return 200, pages_in[index - 1]
        return 404, ""
    with patch.object(parser.time, "sleep", return_value=None):
        report = parser.execute(fetcher=fetch, max_pages=min(len(pages_in), 40), cap=cap)
    return {
        "simulated_page_requests": len(calls),
        "unique_cards_reported": report["unique_search_cards_estimated"],
        "complete_card_observations": report["complete_search_cards_seen_including_repeats"],
        "partial_card_observations": report["partial_search_cards_seen"],
        "duplicate_complete_observations": max(0, report["complete_search_cards_seen_including_repeats"] - report["unique_search_cards_estimated"]),
        "stop_reason": report["stop_reason"],
    }


def score_mixed_pages(records, pages_in):
    expected = {"id:" + row["id"]: expected_fields(row) for row in records}
    correct = set()
    observed = set()
    bad = set()
    unexpected = 0
    for body in pages_in:
        _, entries = inspect_parsed(body)
        for card, values in entries:
            key = card["key"]
            if key not in expected:
                unexpected += 1
                continue
            observed.add(key)
            if values == expected[key]:
                correct.add(key)
            else:
                bad.add(key)
    return {"expected_distinct_ids": len(expected), "recognized_distinct_ids": len(observed),
            "ids_with_at_least_one_exact_observation": len(correct),
            "ids_with_any_incorrect_observation": len(bad),
            "unexpected_or_unlinked_observations": unexpected,
            "missing_distinct_ids": len(set(expected) - observed)}


def malformed_checks():
    row = truth(0)
    normal_card = render(row)
    cases = {
        "missing_price": normal_card.replace(fmt(row["price"], " ") + " €", "Prix indisponible"),
        "missing_title": normal_card.replace(row["title"], ""),
        "monthly_only": normal_card.replace(fmt(row["price"], " ") + " €", "Dès 250 €/mois"),
        "invalid_mileage": normal_card.replace("0 km", "3000000 km"),
        "missing_year": normal_card.replace(str(row["year"]) + "·", ""),
    }
    outcomes = {}
    for name, body in cases.items():
        parsed = parser.parse_page(body)
        outcomes[name] = sum(c["complete"] for c in parsed["cards"]) == 0
    return outcomes


def stop_checks(sample):
    output = {}
    cases = {
        "http403": (403, "Forbidden"),
        "http429": (429, "Too many requests"),
        "captcha": (200, "captcha"),
        "challenge": (200, "Verify that you are human"),
    }
    for name, failure in cases.items():
        calls = []
        def fetch(index):
            calls.append(index)
            return failure if index == 2 else (200, sample)
        with patch.object(parser.time, "sleep", return_value=None):
            r = parser.execute(fetcher=fetch, max_pages=4)
        output[name] = {"calls": len(calls), "stop_reason": r["stop_reason"],
                        "no_followup_after_signal": len(calls) == 2}
    calls = []
    def timeout(index):
        calls.append(index)
        if index == 2:
            raise TimeoutError("synthetic timeout")
        return 200, sample
    with patch.object(parser.time, "sleep", return_value=None):
        r = parser.execute(fetcher=timeout, max_pages=4)
    output["timeout"] = {"calls": len(calls), "stop_reason": r["stop_reason"],
                         "no_followup_after_signal": len(calls) == 2}
    return output


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    start = time.monotonic()
    records = [truth(i) for i in range(500)]
    def deny_network(*args, **kwargs):
        raise AssertionError("Live HTTP forbidden in offline benchmark")
    with patch.object(urllib.request, "urlopen", side_effect=deny_network):
        single, variants = score_single(records)
        clean_pages = pages(records, clean=True)
        mixed_pages = pages(records)
        clean = simulate(clean_pages)
        mixed = simulate(mixed_pages)
        mixed_quality = score_mixed_pages(records, mixed_pages)
        invalid = malformed_checks()
        stops = stop_checks(render(records[0]))
    result = {
        "schema_version": "autofindex-offline-500-validation/v1",
        "fixture_type": "synthetic_generated_local", "fixture_distinct_records": len(records),
        "live_requests": 0, "database_updated": False, "source_access_approved": False,
        "isolated_card_quality": single, "quality_by_format": variants,
        "clean_pagination": clean, "mixed_pagination": mixed,
        "mixed_page_exactness": mixed_quality, "malformed_cards_rejected": invalid,
        "stop_checks": stops, "elapsed_seconds": round(time.monotonic() - start, 3),
    }
    result["validation_passed"] = (
        single["tested"] == 500
        and single.get("all_fields_and_id_exact", 0) == 500
        and clean["unique_cards_reported"] == 500
        and clean["stop_reason"] == "target_500_cards_reached"
        and mixed_quality["ids_with_at_least_one_exact_observation"] == 500
        and mixed_quality["ids_with_any_incorrect_observation"] == 0
        and mixed_quality["unexpected_or_unlinked_observations"] == 0
        and all(invalid.values())
        and all(s["no_followup_after_signal"] for s in stops.values())
    )
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "offline-500-validation.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print("AUTOFINDEX_OFFLINE_500 " + json.dumps(result, ensure_ascii=False), flush=True)
    # A successful job denotes completed measurement; validation_passed is the
    # separately reported quality gate. Never substitute synthetic for live.
    if not (single["tested"] == 500 and all(s["no_followup_after_signal"] for s in stops.values())):
        raise SystemExit("Test coverage or stop-rule regression")


if __name__ == "__main__":
    main()
