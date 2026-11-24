#!/usr/bin/env python3
"""Bounded live public vehicle-search API validation, no marketplace HTML access.

Only aggregate metrics and redacted incident records are stored.
"""
import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlsplit

import jina_offline_500_validation as replay

ENDPOINT = "https://www.pistontraders.co.uk/api/v1/vehicles/"
DOCS = "https://www.pistontraders.co.uk/developers/vehicles-api/schema/"
CAP = 500
MAX_PAGES = 25
MIN_GAP = 3
MAX_SECONDS = 300
MAX_BYTES = 4_000_000
REQUIRED = ("make","model","price","year","mileage","url")
OPTIONAL = ("fuel_type","transmission","engine_size","loc","thumbnail")
YEAR_MAX = 2027
SIGNAL = re.compile(r"captcha|verify (?:that )?you are human|access denied|datadome|challenge-platform", re.I)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read_page(page):
    url = ENDPOINT + "?page=" + str(page)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "AutoFindex-Validation/1.0 (bounded documented API test)",
    })
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=15) as res:
            return res.status, res.headers.get("Content-Type",""), res.read(MAX_BYTES+1)
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type",""), e.read(16000)


def number(value, integer=False, minimum=0, maximum=None):
    if isinstance(value,bool) or value is None:
        raise ValueError("invalid_number")
    try:
        n = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise ValueError("invalid_number") from None
    if not n.is_finite() or n < minimum or (maximum is not None and n > maximum):
        raise ValueError("number_out_of_range")
    if integer and n != n.to_integral_value():
        raise ValueError("non_integer")
    return int(n) if integer else n


def text_value(value):
    if not isinstance(value,str) or not value.strip() or len(value)>240:
        raise ValueError("invalid_text")
    return " ".join(value.split())


def listing_url(value):
    if not isinstance(value,str):
        raise ValueError("invalid_url")
    value = value.strip()
    u = urlsplit(value)
    if u.scheme not in ("https","http") or not u.hostname or u.username or u.password:
        raise ValueError("invalid_url")
    return value


def normalise(row):
    checks = {
        "make": text_value, "model": text_value,
        "price": lambda x: number(x, minimum=Decimal("0.01"), maximum=10_000_000),
        "year": lambda x: number(x, integer=True, minimum=1886, maximum=YEAR_MAX),
        "mileage": lambda x: number(x, integer=True, minimum=0, maximum=2_000_000),
        "url": listing_url,
    }
    values, statuses = {}, {}
    for field, fn in checks.items():
        if field not in row or row[field] is None or row[field] == "":
            statuses[field] = "missing"
            continue
        try:
            values[field] = fn(row[field])
            statuses[field] = "valid"
        except (ValueError, TypeError, OverflowError):
            statuses[field] = "invalid"
    return values,statuses


def replay_row(values, index):
    # Fixed test conversion factors; not market exchange-rate estimates.
    p = int((values["price"]*Decimal("1.15")).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    km = int((Decimal(values["mileage"])*Decimal("1.609344")).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    return {
        "id": str(920000000000+index),
        "title": values["make"]+" "+values["model"],
        "year":values["year"],"price":p,"mileage":km,
        "variant":"standard",
    }


def validate_replay(rows, incidents):
    expected = {"id:"+r["id"]:r for r in rows}
    exact = set()
    observed = set()
    bad = set()
    unexpected = 0
    partial = 0
    for page,start in enumerate(range(0,len(rows),40),1):
        body = "\n\n".join(replay.render(r) for r in rows[start:start+40])
        parsed, entries = replay.inspect_parsed(body)
        partial += sum(not c["complete"] for c in parsed["cards"])
        for card,fields in entries:
            key = card["key"]
            if key not in expected:
                unexpected += 1
                incidents.append({"stage":"replay","page":page,"code":"unexpected_or_unlinked_test_id"})
                continue
            observed.add(key)
            row = expected[key]
            exp = replay.expected_fields(row)
            if fields == exp:
                exact.add(key)
            else:
                bad.add(key)
                mismatch = [f for f,a,b in zip(replay.FIELDS,fields,exp) if a!=b]
                incidents.append({"stage":"replay","page":page,"sample":int(row["id"])-920000000000,
                                  "code":"field_mismatch","fields":mismatch})
    for key in expected.keys()-observed:
        incidents.append({"stage":"replay","sample":int(expected[key]["id"])-920000000000,
                          "code":"missing_test_id"})
    return {
        "kind":"local_markdown_reconstruction_of_live_api_records",
        "eligible_rows":len(rows),"exact_rows":len(exact-bad),
        "missing_test_ids":len(expected.keys()-observed),
        "incorrect_test_ids":len(bad),"unexpected_observations":unexpected,
        "partial_observations":partial,"test_ids_artificial":True,
        "jina_conversion_used":False,
    }


def execute(fetch=read_page, *, gap=MIN_GAP, limit=CAP, max_pages=MAX_PAGES):
    if limit>CAP or max_pages>MAX_PAGES or gap<MIN_GAP:
        raise ValueError("benchmark cap exceeded")
    started=time.monotonic()
    report={
        "schema_version":"autofindex-authorized-live-api/v1",
        "source":"PistonTraders public vehicle-search JSON API",
        "source_docs":DOCS,"market":"UK","target_rows":limit,
        "max_requests":max_pages,"minimum_request_gap_seconds":gap,
        "attempts":0,"http_responses":0,"http_status_counts":{},
        "rows_received":0,"rows_processed":0,"rows_with_all_required_fields":0,
        "unique_listing_urls":0,"duplicate_url_rows":0,"complete_unique_listings":0,
        "native_field_status":{},"optional_fields_present":{},
        "per_page":[],"incidents":[],"stop_reason":None,
        "source_currency":"GBP","source_mileage_unit":"miles",
        "price_conversion_test_factor":"1.15","distance_conversion_factor":"1.609344",
        "live_jina_requests":0,"live_leboncoin_requests":0,
        "database_updated":False,"raw_listings_stored":False,
        "industrial_redistribution_permission_verified":False,
    }
    statuses=Counter()
    field_counts={f:Counter() for f in REQUIRED}
    optional_counts=Counter()
    urls=set()
    full_urls=set()
    page_hashes=set()
    replay_records=[]
    last_start=None
    reason=None
    for page in range(1,max_pages+1):
        if report["rows_processed"]>=limit:
            reason="target_rows_reached";break
        if time.monotonic()-started>=MAX_SECONDS:
            reason="time_budget";break
        if last_start is not None:
            wait=gap-(time.monotonic()-last_start)
            if wait>0: time.sleep(wait)
        if time.monotonic()-started>=MAX_SECONDS:
            reason="time_budget";break
        last_start=time.monotonic()
        report["attempts"]+=1
        info={"page":page,"http_status":None,"rows_received":0,"rows_processed":0}
        report["per_page"].append(info)
        try:
            status,content_type,body=fetch(page)
            info.update(http_status=status,content_type=content_type,
                        response_bytes=len(body),
                        duration_seconds=round(time.monotonic()-last_start,3))
            report["http_responses"]+=1
            statuses[str(status)]+=1
            if status != 200:
                reason=("access_refused" if status in (401,403,407,429)
                        else "redirect" if 300<=status<400 else "http_error")
                break
            if len(body)>MAX_BYTES:
                reason="response_size_limit";break
            if "json" not in content_type.lower():
                reason="verification_signal" if SIGNAL.search(body[:20000].decode("utf-8","replace")) else "non_json_response"
                break
            try:
                data=json.loads(body)
            except (ValueError,UnicodeError):
                reason="invalid_json";break
            if not isinstance(data,dict) or not isinstance(data.get("results"),dict):
                reason="schema_mismatch";break
            result=data["results"]
            cars=result.get("cars")
            if not isinstance(cars,list):
                reason="schema_mismatch";break
            report["rows_received"]+=len(cars)
            info["rows_received"]=len(cars)
            try:
                actual=number(result.get("current_page"),integer=True,minimum=1)
                total_pages=number(result.get("total_pages"),integer=True,minimum=0)
                total=number(result.get("total_vehicles"),integer=True,minimum=0)
            except ValueError:
                reason="invalid_pagination_metadata";break
            info.update(current_page=actual,total_pages=total_pages,total_vehicles=total)
            if actual!=page:
                reason="pagination_mismatch";break
            if not cars:
                reason="no_more_results";break
            page_hash=hashlib.sha256(json.dumps(cars,sort_keys=True).encode()).hexdigest()
            if page_hash in page_hashes:
                reason="repeated_page";break
            page_hashes.add(page_hash)
            for row in cars[:limit-report["rows_processed"]]:
                report["rows_processed"]+=1
                info["rows_processed"]+=1
                index=report["rows_processed"]
                if not isinstance(row,dict):
                    row={}
                values,validity=normalise(row)
                for f,status_name in validity.items():
                    field_counts[f][status_name]+=1
                for field in OPTIONAL:
                    if row.get(field) is not None and row.get(field)!="":
                        optional_counts[field]+=1
                bad={f:s for f,s in validity.items() if s!="valid"}
                if bad:
                    report["incidents"].append({"stage":"native_fields","page":page,
                                                "sample":index,"code":"incomplete_or_invalid",
                                                "fields":bad})
                else:
                    report["rows_with_all_required_fields"]+=1
                if "url" not in values:
                    continue
                key=hashlib.sha256(values["url"].encode()).hexdigest()
                if key in urls:
                    report["duplicate_url_rows"]+=1
                    report["incidents"].append({"stage":"native_identity","page":page,
                                                "sample":index,"code":"duplicate_url"})
                else:
                    urls.add(key)
                if not bad and key not in full_urls:
                    full_urls.add(key)
                    replay_records.append(replay_row(values,index))
            info["outcome"]="parsed"
            if report["rows_processed"]>=limit:
                reason="target_rows_reached";break
            if page>=total_pages:
                reason="no_more_results";break
        except (TimeoutError,urllib.error.URLError,OSError) as exc:
            info["exception_type"]=type(exc).__name__
            reason="network_or_timeout_error";break
        except Exception as exc:
            info["exception_type"]=type(exc).__name__
            reason="pipeline_error";break
    if reason is None: reason="max_requests_reached"
    if report["per_page"] and report["per_page"][-1].get("outcome")!="parsed":
        info=report["per_page"][-1]
        info["outcome"]=reason
        report["incidents"].append({"stage":"acquisition","page":info["page"],"code":reason,
                                    "http_status":info["http_status"],
                                    "exception_type":info.get("exception_type")})
    report["stop_reason"]=reason
    report["http_status_counts"]=dict(statuses)
    report["native_field_status"]={f:dict(c) for f,c in field_counts.items()}
    report["optional_fields_present"]=dict(optional_counts)
    report["unique_listing_urls"]=len(urls)
    report["complete_unique_listings"]=len(full_urls)
    try:
        report["replay"]=validate_replay(replay_records,report["incidents"])
    except Exception as exc:
        report["replay"]={"eligible_rows":len(replay_records),"outcome":"pipeline_error"}
        report["incidents"].append({"stage":"replay","code":"pipeline_error","exception_type":type(exc).__name__})
    report["acquisition_target_reached"]=report["rows_processed"]==limit and reason=="target_rows_reached"
    report["complete_unique_target_reached"]=len(full_urls)==limit
    report["replay_all_eligible_exact"]=bool(replay_records) and report["replay"].get("exact_rows")==len(replay_records) and report["replay"].get("unexpected_observations")==0
    report["strict_quality_gate_passed"]=report["acquisition_target_reached"] and report["complete_unique_target_reached"] and report["replay_all_eligible_exact"]
    report["incident_count"]=len(report["incidents"])
    report["incidents_by_stage_code"]=dict(Counter(x["stage"]+":"+x["code"] for x in report["incidents"]))
    report["elapsed_seconds"]=round(time.monotonic()-started,3)
    return report


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--out",required=True)
    args=ap.parse_args()
    report=execute()
    folder=Path(args.out);folder.mkdir(parents=True,exist_ok=True)
    (folder/"authorized-live-api.json").write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
    summary={k:v for k,v in report.items() if k not in ("incidents","per_page")}
    summary["first_incidents"]=report["incidents"][:10]
    print("AUTOFINDEX_AUTHORIZED_LIVE_API "+json.dumps(summary,ensure_ascii=False),flush=True)
    if not report["strict_quality_gate_passed"]:
        raise SystemExit("500-row live quality gate incomplete; inspect redacted report")


if __name__=="__main__":
    main()
