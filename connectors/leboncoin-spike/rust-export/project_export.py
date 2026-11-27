"""Import an approved local Rust JSON export into AutoFind's existing private database.

The text filter rejects obvious email addresses, links and French phone numbers
before retaining original bytes. This heuristic cannot detect all personal data.
The original file must already be approved for private retention.
"""
import argparse
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import unicodedata


UTC = timezone.utc
MAX_BYTES = 32 * 1024 * 1024
MAX_ROWS = 10000
TABLE = "aw_acquisition_trial.rust_exports"
MARKER = "aw-leboncoin-native-export/v1"
ID = re.compile(r"[1-9][0-9]{0,19}")
INSTANT = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})")
PHOTO = re.compile(
    r"https://img\.leboncoin\.fr/api/v1/lbcpb1/images/"
    r"(?:(?:[0-9a-f]{2}/){3}(?:[0-9a-f]{40}\.jpg|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})"
    r"|gh/(?:[0-9a-f]{2}/){2}gh[0-9a-f]{38}\.jpg)(?:\?rule=[A-Za-z0-9_-]{1,100})?"
)
TEXT_FIELDS = {"prix", "marque", "modele", "annee", "kilometrage", "carburant", "boite"}
ROW_FIELDS = TEXT_FIELDS | {"index", "source_listing_id", "url", "nb_photos", "media", "images"}
EVIDENCE_FIELDS = {"sale_price_evidence", "vehicle_features_evidence", "vehicle_model_evidence"}
FEATURE_LABELS = {
    "fuel": {"Essence", "Diesel", "Électrique", "Hybride", "Hybride rechargeable", "GPL", "Bioéthanol",
             "GNV", "Hydrogène", "Autre"},
    "gearbox": {"Manuelle", "Automatique", "Semi-automatique"},
    "body": {"Berline", "Citadine", "Break", "SUV, 4x4 et pick-up", "Coupé", "Cabriolet", "Monospace",
             "Minibus", "Utilitaire", "Autre"},
    "color": {"Argent", "Beige", "Blanc", "Bleu", "Bordeaux", "Gris", "Jaune", "Marron", "Noir", "Orange",
              "Rose", "Rouge", "Vert", "Violet", "Autre"},
    "upholstery": {"Tissu", "Tout cuir", "Cuir partiel", "Alcantara", "Velours", "Similicuir", "Autre"},
}
FEATURE_COUNTS = {"doors", "seats"}
FEATURE_FLAGS = {"firstOwner", "inspectionValid", "serviceBook"}
REQUIRED_GRANT = {"source_listing_id", "url", "price", "mileage", "description", "media"}
CONTACT = re.compile(
    r"[\w.%+'-]+@[\w.-]+\.[\w-]{2,}|(?:[a-z][a-z0-9+.\-]*://|www\.)\S+"
    r"|(?<!\d)(?:0[\s.()-]*[1-9]|(?:\+33|0033)[\s.-]*(?:\(0\)[\s.-]*)?[1-9])(?:[\s./()-]*[0-9]){8}(?!\d)",
    re.IGNORECASE,
)

# Only controlled vehicle vocabulary can leave the private export. The Rust parser also
# returns fragments of ad titles for unknown models; those must stay out of the listing view.
MODELS = {
    1: json.loads(Path(__file__).with_name("vehicle_labels.json").read_text(encoding="utf-8")),
    2: json.loads(Path(__file__).with_name("vehicle_labels_v2.json").read_text(encoding="utf-8")),
}


class Rejected(ValueError):
    """Fixed error codes; no untrusted ad text or credentials in diagnostics."""


def require(valid, reason):
    if not valid:
        raise Rejected(reason)


def instant(value):
    require(isinstance(value, str) and INSTANT.fullmatch(value), "invalid_timestamp")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except (ValueError, OverflowError):
        raise Rejected("invalid_timestamp") from None


def unique_fields(pairs):
    fields = dict(pairs)
    require(len(fields) == len(pairs), "duplicate_json_field")
    return fields


def decode(data):
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=unique_fields)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise Rejected("invalid_json") from None


@dataclass(frozen=True)
class Policy:
    start: datetime
    end: datetime
    raw: timedelta
    normalized: timedelta
    media: timedelta


def load_policy(path, now):
    try:
        registry = decode(Path(path).read_bytes())
        revision = registry["revisions"][-1]
        config = revision["configuration"]
        scope = config["policy"]
        require(isinstance(scope, dict) and isinstance(scope.get("pii"), dict)
                and scope["pii"].get("mode") == "none", "invalid_private_pii_policy")
        require(registry["sourceId"] == "leboncoin-fr" and registry["schemaVersion"] == 1
                and revision["state"] == "enabled" and config["legalStatus"] == "permitted_crawl"
                and "FR" in config["territories"] and "crawl" in config["acquisitionMethods"]
                and scope["media"]["mode"] == "reference" and scope["media"]["attributionRequired"] is True
                and any(grant["territory"] == "FR" and grant["acquisitionMethod"] == "crawl"
                        and grant["audience"] == "consumer" and REQUIRED_GRANT.issubset(grant["fields"])
                        for grant in scope["grants"]), "unavailable_private_scope")
        start = instant(scope["authorization"]["validFrom"])
        end = instant(scope["authorization"]["validUntil"])
        require(start <= now < end, "outside_private_permission")
        durations = []
        for key in ("rawSeconds", "normalizedSeconds", "mediaSeconds"):
            seconds = scope["retention"][key]
            require(type(seconds) is int and 0 < seconds <= 100 * 366 * 86400, "invalid_retention")
            durations.append(timedelta(seconds=seconds))
        return Policy(start, end, *durations)
    except (OSError, KeyError, TypeError, IndexError):
        raise Rejected("invalid_policy") from None


def read_export(path):
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        initial = os.fstat(stream.fileno())
        require(stat.S_ISREG(initial.st_mode) and 0 < initial.st_size <= MAX_BYTES, "invalid_export_size_or_type")
        raw = stream.read(MAX_BYTES + 1)
        final = os.fstat(stream.fileno())
        require(len(raw) == initial.st_size == final.st_size and
                (initial.st_mtime_ns, initial.st_ctime_ns) == (final.st_mtime_ns, final.st_ctime_ns),
                "export_changed_while_reading")
        seconds, ns = divmod(initial.st_mtime_ns, 1_000_000_000)
        return raw, datetime.fromtimestamp(seconds, UTC).replace(microsecond=ns // 1000)


def media(row, exported_at, policy):
    urls, metadata = row["images"], row["media"]
    if urls is None:
        require(metadata is None and row["nb_photos"] is None, "invalid_unknown_gallery")
        return None, None, None
    require(isinstance(urls, list) and len(urls) <= 200 and type(row["nb_photos"]) is int
            and row["nb_photos"] == len(urls) and all(isinstance(u, str) and PHOTO.fullmatch(u) for u in urls),
            "invalid_photo_reference")
    require(isinstance(metadata, dict) and set(metadata) == {"attribution", "observed_at", "retain_until"}
            and metadata["attribution"] == "Leboncoin", "invalid_photo_attribution")
    observed = instant(metadata["observed_at"])
    retain_until = min(instant(metadata["retain_until"]), observed + policy.media, policy.end)
    require(policy.start <= observed <= exported_at and observed < retain_until, "invalid_gallery_dates")
    return observed, retain_until, urls


def verified_sale_price(row):
    if "sale_price_evidence" not in row:
        return None
    evidence = row["sale_price_evidence"]
    require(isinstance(evidence, dict) and set(evidence) == {"schema", "list_id", "currency", "amount_minor"}
            and evidence["schema"] == "searchData.ads.offer.price/v1"
            and evidence["list_id"] == row["source_listing_id"] and evidence["currency"] == "EUR",
            "invalid_sale_price_evidence")
    cents = evidence["amount_minor"]
    require(type(cents) is int and 0 < cents <= 9_007_199_254_740_991
            and cents % 100 == 0 and row["prix"] == str(cents // 100), "invalid_sale_price_amount")
    return cents


def verified_vehicle_features(row):
    if "vehicle_features_evidence" not in row:
        return None
    evidence = row["vehicle_features_evidence"]
    require(isinstance(evidence, dict) and set(evidence) == {"schema", "list_id", "attributes"}
            and evidence["schema"] == "searchData.ads.offer.features/v1"
            and evidence["list_id"] == row["source_listing_id"], "invalid_vehicle_features_evidence")
    attrs = evidence["attributes"]
    require(isinstance(attrs, dict) and attrs and attrs.keys() <= FEATURE_LABELS.keys() | FEATURE_COUNTS | FEATURE_FLAGS,
            "invalid_vehicle_features")
    for name, value in attrs.items():
        if name in FEATURE_LABELS:
            valid = isinstance(value, str) and value in FEATURE_LABELS[name]
        elif name in FEATURE_COUNTS:
            valid = type(value) is int and 1 <= value <= 9
        else:
            valid = type(value) is bool
        require(valid, "invalid_vehicle_features")
    return attrs


def vehicle_identity(row, labels_version):
    brand, model = row["marque"], row["modele"]
    if "vehicle_model_evidence" in row:
        require(labels_version == 2, "invalid_stored_labels_version")
        require(brand in MODELS[2] and model in MODELS[2][brand] and row["vehicle_model_evidence"] == {
            "schema": "searchData.ads.offer.model/v1", "list_id": row["source_listing_id"],
            "brand": brand, "model": model,
        }, "invalid_vehicle_model_evidence")
        return brand, model

    # Older producers extract title fragments. Preserve their original controlled projection.
    if brand not in MODELS[1]:
        return None, None
    candidate = (model or "").casefold().strip()
    match = max((label for label in MODELS[1][brand]
                 if candidate == label.casefold() or candidate.startswith(label.casefold() + " ")),
                key=len, default=None)
    return brand, match


def saved_labels_version(stored):
    require(isinstance(stored, list) and stored and all(isinstance(row, dict) for row in stored),
            "existing_archive_mismatch")
    if all("vehicle_labels_version" not in row for row in stored):
        require(all("vehicle_features" not in row for row in stored), "invalid_stored_labels_version")
        return 1
    require(all(type(row.get("vehicle_labels_version")) is int and row["vehicle_labels_version"] == 2 for row in stored),
            "invalid_stored_labels_version")
    return 2


def same_projection(stored, expected):
    # Python considers False == 0 and True == 1. A persisted JSON boolean,
    # integer or float must replay as the same type as the archived projection.
    return json.dumps(stored, sort_keys=True) == json.dumps(expected, sort_keys=True)


def project(raw, exported_at, basis, policy, now, *, labels_version=2):
    require(policy.start <= exported_at <= now < policy.end, "invalid_export_date")
    require(basis in {"file_mtime", "producer_completion"}, "invalid_export_date_basis")
    rows = decode(raw)
    require(isinstance(rows, list) and 1 <= len(rows) <= MAX_ROWS, "invalid_export_rows")
    projections, seen = [], set()
    require(type(labels_version) is int and labels_version in MODELS, "invalid_stored_labels_version")
    deadline = min(policy.end, exported_at + policy.raw, exported_at + policy.normalized)
    for row in rows:
        require(isinstance(row, dict) and (row.keys() - EVIDENCE_FIELDS) == ROW_FIELDS and type(row["index"]) is int
                and row["index"] >= 0 and all(row[k] is None or isinstance(row[k], str) and len(row[k]) <= 128
                                            for k in TEXT_FIELDS), "invalid_native_row")
        require(not any(CONTACT.search(unicodedata.normalize("NFKC", row[k] or "")) for k in TEXT_FIELDS),
                "contact_in_native_vehicle_text")
        key = row["source_listing_id"]
        require(isinstance(key, str) and ID.fullmatch(key) and row["url"] == "https://www.leboncoin.fr/ad/voitures/" + key,
                "invalid_listing_identity")
        require(key not in seen, "duplicate_listing_id")
        seen.add(key)
        observed, expiry, urls = media(row, exported_at, policy)
        if observed is not None:
            deadline = min(deadline, expiry, observed + policy.raw, observed + policy.normalized)
        make, model = vehicle_identity(row, labels_version)
        km = re.fullmatch(r"(0|[1-9][0-9]{0,8})\s*km", row["kilometrage"] or "", re.I)
        year = int(row["annee"]) if re.fullmatch(r"[0-9]{4}", row["annee"] or "") else 0
        projected = {
            "source_listing_id": key, "brand": make, "model": model,
            "year": year if 1886 <= year <= exported_at.year + 2 else None,
            "price_amount_minor": verified_sale_price(row), "mileage_km": int(km[1]) if km else None,
            "images": urls, "media_observed_at": observed.isoformat() if observed else None,
            "media_retain_until": expiry.isoformat() if expiry else None, "export_time_basis": basis,
        }
        if labels_version == 2:
            projected["vehicle_labels_version"] = 2
        features = verified_vehicle_features(row)
        if features is not None:
            require(labels_version == 2, "invalid_stored_labels_version")
            projected["vehicle_features"] = features
        projections.append(projected)
    require(deadline > now, "export_retention_expired")
    return projections, deadline


def receipt(digest, rows, exported_at, deadline, basis, status):
    return {"status": status, "export_sha256": digest, "rows": len(rows),
            "photo_references": sum(len(r["images"] or ()) for r in rows),
            "exported_at": exported_at.isoformat(), "export_time_basis": basis, "retain_until": deadline.isoformat()}


def import_to_database(service, raw, digest, file_time, explicit_time, policy_path):
    # Imported lazily so inspecting a file needs only the Python standard library.
    import psycopg2
    from psycopg2.extras import Json

    require(isinstance(service, str) and re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", service),
            "named_postgres_service_required")
    read_export_row = """
        SELECT raw_bytes, exported_at, retain_until, row_count, listings
        FROM aw_acquisition_trial.rust_exports WHERE export_sha256=%s
    """
    try:
        with closing(psycopg2.connect(service=service, connect_timeout=8)) as conn, conn, conn.cursor() as cur:
            cur.execute("SET LOCAL search_path=pg_catalog")
            cur.execute("SET LOCAL lock_timeout='5s'")
            cur.execute("SET LOCAL statement_timeout='30s'")
            cur.execute("SELECT current_database(),obj_description(to_regclass(%s),'pg_class')", (TABLE,))
            require(cur.fetchone() == ("autoworld", MARKER), "wrong_project_database_or_migration")
            # Contending copies of the same artifact must use the first committed export date.
            cur.execute("SELECT pg_advisory_xact_lock(%s)", (int.from_bytes(bytes.fromhex(digest[:16]), "big", signed=True),))
            cur.execute(read_export_row, (digest,))
            previous = cur.fetchone()
            at = explicit_time or file_time
            basis = "producer_completion" if explicit_time else "file_mtime"
            labels_version = 2
            if previous is not None:
                stored_body, at, old_deadline, stored_count, stored = previous
                require(bytes(stored_body) == raw, "existing_archive_mismatch")
                labels_version = saved_labels_version(stored)
                basis = stored[0].get("export_time_basis")
                require(explicit_time is None or at == explicit_time, "conflicting_export_date")
            cur.execute("SELECT clock_timestamp()")
            now = cur.fetchone()[0]
            rows, deadline = project(raw, at, basis, load_policy(policy_path, now), now, labels_version=labels_version)
            if previous is not None:
                require(same_projection(stored, rows) and stored_count == len(rows) and now < old_deadline <= deadline,
                        "existing_projection_or_retention_mismatch")
                return receipt(digest, rows, at, old_deadline, basis, "already_imported")

            cur.execute("""
                INSERT INTO aw_acquisition_trial.rust_exports
                    (export_sha256, raw_bytes, exported_at, retain_until, row_count, listings)
                SELECT %s, %s, %s, %s, %s, %s WHERE %s > clock_timestamp()
            """, (digest, raw, at, deadline, len(rows), Json(rows), deadline))
            require(cur.rowcount == 1, "expired_before_insert")
            cur.execute(read_export_row, (digest,))
            stored = cur.fetchone()
            require(stored is not None and bytes(stored[0]) == raw and tuple(stored[1:4]) == (at, deadline, len(rows))
                    and same_projection(stored[4], rows),
                    "stored_export_verification_failed")
            return receipt(digest, rows, at, deadline, basis, "inserted")
    except psycopg2.Error as exc:
        raise Rejected("postgres_" + (exc.pgcode or "unavailable")) from None


def process(path, policy_path, *, service=None, exported_at=None, expected_sha256=None, now=None):
    raw, file_time = read_export(path)
    digest = hashlib.sha256(raw).hexdigest()
    require(expected_sha256 is None or expected_sha256 == digest, "export_sha256_mismatch")
    explicit_time = instant(exported_at) if exported_at is not None else None
    if service is not None:
        return import_to_database(service, raw, digest, file_time, explicit_time, policy_path)
    now = now or datetime.now(UTC)
    at = explicit_time or file_time
    basis = "producer_completion" if explicit_time else "file_mtime"
    rows, deadline = project(raw, at, basis, load_policy(policy_path, now), now)
    return receipt(digest, rows, at, deadline, basis, "inspected")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export", type=Path)
    parser.add_argument("--policy", required=True, type=Path)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--inspect", action="store_true", help="Validate and count the local file without PostgreSQL")
    target.add_argument("--service", help="Local libpq service name for the existing AutoFind private database")
    parser.add_argument("--exported-at", help="Known exporter completion time in RFC 3339; defaults to file mtime")
    parser.add_argument("--expected-sha256", help="Independently recorded SHA-256 of the entire export")
    args = parser.parse_args()
    try:
        print(json.dumps(process(args.export, args.policy, service=args.service, exported_at=args.exported_at,
                                 expected_sha256=args.expected_sha256)))
    except Rejected as exc:
        sys.exit(str(exc))
    except OSError:
        sys.exit("local_export_unavailable")
    except ImportError:
        sys.exit("postgres_driver_unavailable")


if __name__ == "__main__":
    main()
