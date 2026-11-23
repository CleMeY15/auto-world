#!/usr/bin/env python3
"""500-URL, one-shot Jina Reader check. Metrics only; no listing content persisted."""
import importlib.util
import json
import sys
from collections import Counter, deque
from pathlib import Path

SRC = Path(__file__).with_name("free-benchmark.py")
spec = importlib.util.spec_from_file_location("autofindex_free_bench", SRC)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

LIMIT = 500
MAX_SECONDS = 180 * 60
BASE_CLASSIFY = base.classify
base.CAP = LIMIT
base.GAP = 10
base.BUDGET_SECONDS = MAX_SECONDS


def classify_checked(body, status=None):
    """Classify transport failures independently from automotive-field hints."""
    outcome, fields = BASE_CLASSIFY(body, status)
    if status in (401, 402, 407):
        return "refused", fields
    if status in (403, 429):
        return "refused", fields
    if status in (404, 410):
        return "not_found", fields
    if isinstance(status, int) and 500 <= status < 600:
        return "server_error", fields
    if isinstance(status, int) and 400 <= status < 500:
        return "http_error", fields
    if status == 200 and not str(body).strip():
        return "empty_response", fields
    return outcome, fields


base.classify = classify_checked


class ScaleBench(base.Bench):
    def __init__(self, urls):
        super().__init__("jina-500", urls)
        self.http_status_counts = Counter()
        self.unique_body_hashes = set()
        self.duplicate_body_count = 0
        self.server_errors_total = 0
        self.server_errors_consecutive = 0
        self.last_http_status = None
        self.last_outcome = None
        self.recent_http_200 = deque(maxlen=20)
        self.field_hints = Counter()
        self.content_length_total = 0

    def add(self, target, outcome, status=None, fields=None, body="", duration=None):
        super().add(target, outcome, status, fields, body, duration)
        self.last_http_status = status
        self.last_outcome = outcome
        if status is not None:
            self.http_status_counts[str(status)] += 1
        body = str(body)
        self.content_length_total += len(body)
        self.rows[-1]["response_characters"] = len(body)
        if body:
            body_hash = base.digest(body)
            if body_hash in self.unique_body_hashes:
                self.duplicate_body_count += 1
            else:
                self.unique_body_hashes.add(body_hash)
        for field, found in (fields or {}).items():
            if field.endswith("_hint") and found:
                self.field_hints[field] += 1
        if outcome == "server_error":
            self.server_errors_total += 1
            self.server_errors_consecutive += 1
        else:
            self.server_errors_consecutive = 0
        if self.server_errors_consecutive >= 3 or self.server_errors_total >= 5:
            self.reason = "server_errors_limit"
        if status == 200:
            self.recent_http_200.append(outcome in ("no_vehicle_data", "empty_response"))
            if len(self.recent_http_200) == 20 and sum(self.recent_http_200) >= 18:
                self.reason = "non_vehicle_response_spike"

    def consider_links(self, body):
        # Ignore links appearing on error and generic pages.
        if self.last_http_status == 200 and self.last_outcome in ("complete", "partial"):
            super().consider_links(body)

    def output(self, out_dir, installed=True):
        report = super().output(out_dir, installed)
        report.update({
            "schema_version": "autofindex-jina-scale/v1",
            "requested_cap": LIMIT,
            "minimum_interval_seconds": base.GAP,
            "http_status_counts": dict(self.http_status_counts),
            "server_errors_total": self.server_errors_total,
            "duplicate_content_responses": self.duplicate_body_count,
            "distinct_content_responses": len(self.unique_body_hashes),
            "field_hint_counts": dict(self.field_hints),
            "total_response_characters": self.content_length_total,
            "detail_validation_completed": False,
            "success_counts_are_heuristic_hints": True,
            "raw_content_stored": False,
            "source_access_approved": False,
            "database_updated": False,
        })
        folder = Path(out_dir)
        (folder / "jina-500.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        public = {key: value for key, value in report.items() if key != "rows"}
        print("AUTOFINDEX_JINA_SCALE " + json.dumps(public, ensure_ascii=False), flush=True)
        return report


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--seeds", default=str(SRC.with_name("free-benchmark-seeds.json")))
    args = parser.parse_args()
    seeds = json.loads(Path(args.seeds).read_text(encoding="utf-8"))
    if not isinstance(seeds, list) or len(seeds) < 3:
        raise ValueError("At least three observed URLs required")
    if len(seeds) != len(set(seeds)) or not all(base.URL_RE.fullmatch(u) for u in seeds):
        raise ValueError("Only unique observed Leboncoin car URLs accepted")
    benchmark = ScaleBench(seeds)
    base.run_details(benchmark, base.fetch_jina)
    benchmark.output(args.out)


if __name__ == "__main__":
    main()
