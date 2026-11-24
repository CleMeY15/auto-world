#!/usr/bin/env python3
"""Explain Jina Reader verification signals without retaining page contents.

Diagnostic-only CLI: makes exactly one Jina request for search page 9,
with no retries, CAPTCHA interaction, proxy use or follow-up pagination.
All output is redacted summary metadata; never stores raw HTML/Markdown.
"""
import argparse
import hashlib
import importlib.util
import json
import re
import time
from pathlib import Path

MAX_INSPECT_CHARS = 20_000
RULES = {
    "explicit_block": re.compile(
        r"you have been blocked|access denied|your request has been blocked|"
        r"request blocked|vous avez été bloqué", re.I
    ),
    "human_verification": re.compile(
        r"verify (?:that )?you are human|confirm (?:that )?you are not a robot|"
        r"verification required|vérification de sécurité|"
        r"vérifiez que vous êtes humain|vérifiez que vous n['’]êtes pas un robot", re.I
    ),
    "challenge_widget": re.compile(
        r"challenge-platform|captcha-delivery\.com|datadome device check|"
        r"ddcaptcha|g-recaptcha|h-captcha|cf-turnstile|data-sitekey", re.I
    ),
    "provider_name_only": re.compile(
        r"\bdatadome\b|\bhcaptcha\b|\brecaptcha\b|\bgeetest\b|\bturnstile\b", re.I
    ),
    "generic_captcha_word": re.compile(r"\bcaptcha\b", re.I),
}
FORM_MARKUP = re.compile(r"<form\b", re.I)
IFRAME_MARKUP = re.compile(r"<iframe\b", re.I)


def diagnostics(response, parse_page, status=200):
    """Return a safe, explainable classification.

    A bare keyword is NOT proof of a challenge. All positive signals are
    recorded as reasons for *stopping* pending a review, not for bypassing.
    """
    body = response if isinstance(response, str) else ""
    scan = body[:MAX_INSPECT_CHARS]
    matched = {}
    for name, regex in RULES.items():
        found = list(regex.finditer(scan))
        if found:
            matched[name] = {
                "occurrences": len(found),
                "first_offset": found[0].start(),
            }
    raw_form = bool(FORM_MARKUP.search(scan))
    raw_iframe = bool(IFRAME_MARKUP.search(scan))
    related = bool(
        set(matched) & {
            "human_verification", "challenge_widget",
            "provider_name_only", "generic_captcha_word",
        }
    )
    if status != 200:
        verdict = "http_failure"
    elif set(matched) & {"explicit_block", "human_verification", "challenge_widget"}:
        verdict = "explicit_challenge"
    elif related and (raw_form or raw_iframe):
        # Jina may strip forms/iframes; their absence is NOT exculpatory.
        verdict = "possible_challenge"
    elif "provider_name_only" in matched:
        verdict = "possible_challenge"
    elif "generic_captcha_word" in matched:
        verdict = "keyword_only"
    else:
        verdict = "no_signal"
    try:
        parsed = parse_page(body) if status == 200 else None
        card_patterns = parsed["raw_vehicle_patterns"] if parsed else 0
        complete_cards = sum(c["complete"] for c in parsed["cards"]) if parsed else 0
        links = parsed["direct_vehicle_links_in_page"] if parsed else 0
        parsing_error = False
    except (ValueError, TypeError, KeyError):
        card_patterns = complete_cards = links = 0
        parsing_error = True

    return {
        "classification": verdict,
        "rule_names": sorted(matched),
        "rule_evidence": matched,
        "html_form_tag_present": raw_form,
        "html_iframe_tag_present": raw_iframe,
        "verification_form_possible": related and raw_form,
        "verification_iframe_possible": related and raw_iframe,
        "vehicle_patterns_in_same_response": card_patterns,
        "cards_with_four_fields_in_same_response": complete_cards,
        "vehicle_links_in_same_response": links,
        "card_parser_error": parsing_error,
        "scanned_characters": len(scan),
        "response_characters": len(body),
        "response_sha256": hashlib.sha256(body.encode("utf-8", "replace")).hexdigest(),
        "body_text_persisted": False,
    }


def single_page_check(out_dir):
    source = Path(__file__).with_name("jina-list-benchmark.py")
    spec = importlib.util.spec_from_file_location("jina_list_source", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    started = time.monotonic()
    status = None
    response = ""
    error = None
    try:
        # Exactly one live request, no retry, no interaction with any CAPTCHA.
        status, response = module.fetch_page(9)
    except Exception as exc:
        error = type(exc).__name__
    summary = diagnostics(response, module.parse_page, status=status)
    result = {
        "schema_version": "autofindex-jina-verification-diagnostic/v1",
        "page_number": 9,
        "live_requests": 1,
        "http_status": status,
        "network_exception_type": error,
        "duration_seconds": round(time.monotonic() - started, 2),
        "prior_run_ref": 45259765450,
        "prior_run_raw_response_available": False,
        "conclusion_is_about_new_observation_only": True,
        "source_access_approved": False,
        "database_updated": False,
        "raw_content_stored": False,
        "diagnosis": summary,
    }
    folder = Path(out_dir)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "jina-page9-diagnostic.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("AUTOFINDEX_JINA_PAGE9_DIAGNOSTIC " + json.dumps(result, ensure_ascii=False), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    single_page_check(args.out)


if __name__ == "__main__":
    main()
