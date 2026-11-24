#!/usr/bin/env python3
"""Real historical data replay; never contacts a marketplace or Jina.

One public Kaggle dataset download. All card markup and identifiers are local
test representations of published numeric data, not captures of live ads.
Reports include stage-level failures without copying seller or listing data.
"""
import argparse
import csv
import hashlib
import io
import json
import random
import re
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter, defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from unittest.mock import patch

import jina_offline_500_validation as previous

SOURCE = "https://www.kaggle.com/api/v1/datasets/download/adityadesai13/used-car-dataset-ford-and-mercedes"
SOURCE_CARD = "https://www.kaggle.com/datasets/adityadesai13/used-car-dataset-ford-and-mercedes"
FILES = {"audi.csv":"Audi", "bmw.csv":"BMW", "ford.csv":"Ford",
         "hyundi.csv":"Hyundai", "merc.csv":"Mercedes-Benz", "skoda.csv":"Skoda",
         "toyota.csv":"Toyota", "vauxhall.csv":"Vauxhall", "vw.csv":"Volkswagen"}
FORMATS = ("standard", "unicode_spacing", "monthly_payment",
           "label_only_price", "model_title")
FIELDS = ("title","price","year","mileage")
LIMIT = 500
MAX_ZIP_BYTES = 16_000_000
REQUIRED = {"model", "year", "price", "mileage"}


def download(report):
    started = time.monotonic()
    stage = report["dataset_download"]
    stage["attempts"] = 1
    try:
        request = urllib.request.Request(SOURCE, headers={"Accept":"application/zip"})
        with urllib.request.urlopen(request, timeout=45) as response:
            stage["http_status"] = response.status
            stage["content_type"] = response.headers.get("Content-Type", "")
            data = response.read(MAX_ZIP_BYTES + 1)
        stage["bytes"] = len(data)
        if len(data) > MAX_ZIP_BYTES:
            raise ValueError("archive_size_limit")
        if not zipfile.is_zipfile(io.BytesIO(data)):
            stage["outcome"] = "non_zip_response"
            raise ValueError("not_a_dataset_zip")
        stage["sha256"] = hashlib.sha256(data).hexdigest()
        stage["outcome"] = "success"
        return data
    except urllib.error.HTTPError as e:
        stage["http_status"] = e.code
        stage["outcome"] = "access_refused" if e.code in (401,403,429) else "http_error"
        raise
    except (TimeoutError, urllib.error.URLError):
        stage["outcome"] = "network_or_timeout_error"
        raise
    finally:
        stage["duration_seconds"] = round(time.monotonic() - started, 3)


def select_rows(data, report):
    rng = random.Random(20261124)
    all_selected = []
    source_stats = report["source_files"]
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = {Path(name).name: name for name in archive.namelist()
                   if Path(name).name in FILES}
        missing = sorted(set(FILES)-set(members))
        if missing:
            report["missing_source_files"] = missing
            raise ValueError("dataset_missing_expected_files")
        for index, (filename, brand) in enumerate(FILES.items()):
            member = members[filename]
            if archive.getinfo(member).file_size > 10_000_000:
                raise ValueError("member_size_limit")
            with archive.open(member) as handle:
                reader = csv.DictReader(io.TextIOWrapper(handle, encoding="utf-8-sig"))
                if not REQUIRED.issubset(set(reader.fieldnames or [])):
                    source_stats[filename] = {"outcome":"missing_required_columns"}
                    raise ValueError("dataset_schema_mismatch")
                # Reservoir sample of actual rows, before filtering invalid values.
                quota = LIMIT // len(FILES) + (index < LIMIT % len(FILES))
                reservoir = []
                count = 0
                for row in reader:
                    count += 1
                    sample = (brand, {k: row.get(k) for k in REQUIRED})
                    if len(reservoir) < quota:
                        reservoir.append(sample)
                    else:
                        j = rng.randrange(count)
                        if j < quota:
                            reservoir[j] = sample
                source_stats[filename] = {"rows_available":count,
                    "rows_selected":len(reservoir),"outcome":"success"}
                all_selected.extend(reservoir)
    rng.shuffle(all_selected)
    return all_selected


def integer(s):
    n = Decimal(str(s).strip())
    if not n.is_finite() or n != n.to_integral_value():
        raise ValueError("not_an_integer")
    return int(n)


def rounded(n):
    return int(n.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def prepare(brand, row, index):
    model = " ".join(str(row.get("model") or "").split())
    year = integer(row["year"])
    gbp = integer(row["price"])
    miles = integer(row["mileage"])
    if not model or not (1950 <= year <= 2029) or gbp <= 0 or miles < 0:
        raise ValueError("invalid_source_field")
    # Fixed, documented test factor; not a current exchange-rate quote.
    eur = rounded(Decimal(gbp)*Decimal("1.15"))
    km = rounded(Decimal(miles)*Decimal("1.609344"))
    variant = FORMATS[(index-1) % len(FORMATS)]
    title = model if variant == "model_title" else brand + " " + model
    return {"id":str(910000000000 + index), "title":title, "price":eur,
            "year":year, "mileage":km, "variant":variant, "sample_index":index}


def render(row):
    return previous.render(row)


def validate(records, report):
    parser = previous.parser
    errors = report["errors"]
    totals = Counter()
    formats = defaultdict(Counter)
    for row in records:
        group = formats[row["variant"]]
        totals["tested"] += 1
        group["tested"] += 1
        _, results = previous.inspect_parsed(render(row))
        if len(results) != 1:
            errors.append({"stage":"isolated_parse","sample_index":row["sample_index"],
                           "format":row["variant"],"code":"missing_or_multiple_complete"})
            group["missing_or_multiple_complete"] += 1
            continue
        card, fields = results[0]
        expected = previous.expected_fields(row)
        mismatches = [field for field,a,b in zip(FIELDS,fields,expected) if a!=b]
        if len(fields)!=len(FIELDS):
            mismatches.append("field_count")
        if card["key"] != "id:"+row["id"]:
            mismatches.append("test_id")
        for field in (*FIELDS,"test_id"):
            if field not in mismatches:
                totals[field+"_exact"] += 1
        if mismatches:
            errors.append({"stage":"isolated_parse","sample_index":row["sample_index"],
                           "format":row["variant"],"code":"value_mismatch",
                           "fields":mismatches})
            group["mismatch"] += 1
        else:
            group["exact"] += 1
            totals["all_fields_and_test_id_exact"] += 1
    report["isolated_quality"] = dict(totals)
    report["quality_by_format"] = {k:dict(v) for k,v in formats.items()}

    pages = []
    for start in range(0,len(records),35):
        pages.append("\n\n".join(render(row) for row in records[start:start+40]))
        if start+40>=len(records):
            break
    if not pages:
        return
    expected = {"id:"+row["id"]:row for row in records}
    observed, exact, bad = set(),set(),set()
    unexpected = 0
    complete_count = 0
    partial_count = 0
    for page,body in enumerate(pages,1):
        parsed, entries = previous.inspect_parsed(body)
        complete_count += len(entries)
        partial_count += sum(not c["complete"] for c in parsed["cards"])
        for card,fields in entries:
            key = card["key"]
            if key not in expected:
                unexpected += 1
                errors.append({"stage":"page_replay","page":page,"code":"unlinked_or_unexpected_test_id"})
                continue
            observed.add(key)
            row = expected[key]
            if fields == previous.expected_fields(row):
                exact.add(key)
            else:
                bad.add(key)
                errors.append({"stage":"page_replay","page":page,
                               "sample_index":row["sample_index"],"code":"value_mismatch"})
    for key in expected.keys()-observed:
        errors.append({"stage":"page_replay","sample_index":expected[key]["sample_index"],
                       "code":"missing_test_id"})
    report["page_quality"] = {
        "pages_reconstructed":len(pages),"expected_test_ids":len(expected),
        "recognized_test_ids":len(observed),"exact_test_ids":len(exact),
        "test_ids_with_any_incorrect_observation":len(bad),
        "unexpected_observations":unexpected,"missing_test_ids":len(expected.keys()-observed),
        "complete_observations":complete_count,"partial_observations":partial_count,
        "duplicate_complete_observations":max(0,complete_count-len(observed)-unexpected),
    }
    report["simulated_pagination"] = previous.simulate(pages,cap=LIMIT)
    report["simulated_stop_checks"] = previous.stop_checks(render(records[0]))
    report["malformed_checks"] = previous.malformed_checks()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out",required=True)
    args = ap.parse_args()
    started = time.monotonic()
    report = {
        "schema_version":"autofindex-real-data-replay/v1",
        "source":{"dataset":SOURCE_CARD,"published_license":"CC0",
                  "type":"historical_used_car_listings_uk","selection_seed":20261124},
        "dataset_download":{"attempts":0,"outcome":"not_started"},
        "source_files":{}, "sample_target":LIMIT,"source_rows_selected":0,
        "source_rows_valid":0,"source_rows_invalid":0,
        "price_gbp_to_eur_test_factor":"1.15","miles_to_km_factor":"1.609344",
        "titles_reconstructed":True,"test_ids_artificial":True,
        "actual_jina_markdown_captured":False,"live_leboncoin_requests":0,
        "live_jina_requests":0,"database_updated":False,
        "source_access_approved_for_leboncoin":False,
        "errors":[], "validation_passed":False,
    }
    try:
        data = download(report)
        rows = select_rows(data,report)
        report["source_rows_selected"] = len(rows)
        report["exact_source_field_tuple_duplicates"] = (
            len(rows)-len({(brand,tuple(row.get(k) for k in sorted(REQUIRED))) for brand,row in rows}))
        records = []
        for index,(brand,row) in enumerate(rows,1):
            try:
                records.append(prepare(brand,row,index))
            except Exception as exc:
                report["errors"].append({"stage":"source_row","sample_index":index,
                                         "code":"invalid_required_value","exception_type":type(exc).__name__})
        report["source_rows_valid"] = len(records)
        report["source_rows_invalid"] = len(rows)-len(records)
        def deny(*a,**k):
            raise AssertionError("Network access forbidden during parser replay")
        with patch.object(urllib.request,"urlopen",side_effect=deny):
            validate(records,report)
        isolated = report.get("isolated_quality",{})
        page = report.get("page_quality",{})
        sim = report.get("simulated_pagination",{})
        stops = report.get("simulated_stop_checks",{})
        report["validation_passed"] = (
            len(rows)==LIMIT and len(records)==LIMIT
            and isolated.get("all_fields_and_test_id_exact")==LIMIT
            and page.get("exact_test_ids")==LIMIT
            and page.get("test_ids_with_any_incorrect_observation")==0
            and page.get("unexpected_observations")==0
            and sim.get("unique_cards_reported")==LIMIT
            and sim.get("stop_reason")=="target_500_cards_reached"
            and sim.get("duplicate_complete_observations")==70
            and len(stops)==5 and all(x["no_followup_after_signal"] for x in stops.values())
            and all(report.get("malformed_checks",{}).values())
        )
    except Exception as exc:
        report["errors"].append({"stage":"pipeline","code":"test_not_completed",
                                 "exception_type":type(exc).__name__})
    report["elapsed_seconds"] = round(time.monotonic()-started,3)
    report["error_count"] = len(report["errors"])
    report["error_counts_by_stage_and_code"] = dict(Counter(
        e["stage"]+":"+e["code"] for e in report["errors"]))
    out = Path(args.out)
    out.mkdir(parents=True,exist_ok=True)
    (out/"real-data-validation.json").write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
    brief = {k:v for k,v in report.items() if k!="errors"}
    brief["first_errors"] = report["errors"][:10]
    print("AUTOFINDEX_REAL_DATA_VALIDATION "+json.dumps(brief,ensure_ascii=False),flush=True)
    if not report["validation_passed"]:
        raise SystemExit("Real-data replay quality gate failed; see aggregate report")

if __name__ == "__main__":
    main()
