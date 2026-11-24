"""Audit saved marketplace result pages. This entry point reads local files only."""
import argparse
import importlib.util
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

from jina_verification_diagnostic import RULES
from leparking_html import parse_html
from leparking_page import parse_page as parse_parking_markdown


def load_leboncoin():
    path = Path(__file__).with_name("jina-list-benchmark.py")
    spec = importlib.util.spec_from_file_location("jina_list_benchmark", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.parse_page


PARSE_LEBONCOIN = load_leboncoin()
FIELDS = ("title", "price_eur", "year", "mileage_km")
FORMATS = ("leboncoin-md", "leparking-md", "leparking-html")


def no_results_status(body):
    sample = body[:20_000]
    if any(RULES[name].search(sample) for name in
           ("explicit_block", "human_verification", "challenge_widget")):
        return "verification_signal"
    if any(RULES[name].search(sample) for name in ("provider_name_only", "generic_captcha_word")):
        return "verification_mention"
    if re.search(r"^\s*(?:aucun(?:e)? (?:résultat|annonce)|0 (?:résultats?|annonces?))[.!]?\s*$",
                 body, re.IGNORECASE | re.MULTILINE):
        return "empty_results"
    return "unrecognized"


def parse_input(mode, body):
    if mode == "leboncoin-md":
        page = PARSE_LEBONCOIN(body, include_linked_rows=True)
        candidates = page["raw_vehicle_patterns"]
        rows = page["rows"]
        status = "results" if rows else "partial" if candidates else no_results_status(body)
        return rows, set(), {}, {"status": status, "observations": candidates,
                             "page_duplicates": 0, "issues": page["row_issues"]}

    page = parse_html(body) if mode == "leparking-html" else parse_parking_markdown(body)
    rows = [{"source": "leparking", "source_id": card["source_id"],
             "source_url": card["url"], **{field: card[field] for field in FIELDS}}
            for card in page["cards"]]
    conflicts = set(page.get("conflict_ids", []))
    status = page["status"]
    if status in {"parsed", "results"}:
        status = "results"
    elif status in {"no_cards", "unrecognized"} and not conflicts:
        status = no_results_status(body)
    if not rows and conflicts:
        status = "conflict"
    elif not rows and status == "results":
        status = "unrecognized"
    issues = {key: page[key] for key in ("ambiguous_cards", "unidentified_or_ambiguous",
                                          "conflicting_fields") if page.get(key)}
    return rows, conflicts, page.get("observed_values", {}), {
                             "status": status, "observations": page["observations"],
                             "page_duplicates": page["duplicates"], "issues": issues}


def audit_files(mode, paths, include_rows=False):
    pages, winners, evidence = [], {}, {}
    seen_ids = set()
    conflicts = set()
    repeats = 0
    for index, path in enumerate(paths, 1):
        try:
            body = Path(path).read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError) as err:
            pages.append({"page": index, "status": "input_error", "reason": type(err).__name__})
            continue
        rows, page_conflicts, observed, metrics = parse_input(mode, body)
        pages.append({"page": index, **metrics})
        conflicts.update(page_conflicts)
        repeats += metrics["page_duplicates"]
        if mode == "leboncoin-md":
            # This adapter returns individual accepted occurrences.
            observed = {}
            for row in rows:
                key = row["source_id"]
                fields = observed.setdefault(key, {})
                for field in FIELDS:
                    fields.setdefault(field, []).append(row[field])
            repeats += len(rows) - len(observed)
        page_ids = {row["source_id"] for row in rows} | page_conflicts | set(observed)
        repeats += len(seen_ids & page_ids)
        seen_ids.update(page_ids)
        for key, fields in observed.items():
            known = evidence.setdefault(key, {})
            for field, values in fields.items():
                for value in values:
                    if isinstance(value, str):
                        value = unicodedata.normalize("NFC", " ".join(value.split()).casefold())
                    if value is None:
                        continue
                    if field in known and known[field] != value:
                        conflicts.add(key)
                    else:
                        known[field] = value
        for row in rows:
            key = row["source_id"]
            # Keep the most detailed single observation. Never synthesize a row.
            score = sum(row[field] is not None for field in FIELDS)
            if key not in winners or score > winners[key][0]:
                winners[key] = (score, row)

    complete = []
    missing = Counter()
    incomplete = 0
    for key, (score, row) in winners.items():
        if key in conflicts:
            continue
        if score == len(FIELDS):
            complete.append(row)
        else:
            incomplete += 1
            missing.update(field for field in FIELDS if row[field] is None)
    report = {"format": mode, "pages": pages, "distinct_identified": len(seen_ids),
              "identity_scope": ("accepted_linked_rows" if mode == "leboncoin-md"
                                 else "source_identifiers_on_cards"),
              "complete_unique": len(complete), "partial_unique": None if mode == "leboncoin-md" else incomplete,
              "conflicting_unique": len(conflicts), "repeat_observations": repeats,
              "missing_fields_on_partial_rows": dict(missing)}
    if include_rows:
        report["rows"] = complete
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("format", choices=FORMATS)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--rows", action="store_true", help="also print individually complete records")
    parser.add_argument("--target", type=int, help="require at least this many complete unique records")
    args = parser.parse_args()
    if args.target is not None and args.target < 1:
        parser.error("--target must be positive")
    report = audit_files(args.format, args.files, args.rows)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if any(page["status"] not in {"results", "partial", "empty_results"} for page in report["pages"]):
        return 2
    if args.target is not None and report["complete_unique"] < args.target:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
