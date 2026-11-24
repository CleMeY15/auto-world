"""Select 2,000 historical records from the pinned, publicly released UK dataset."""
import argparse
import csv
import hashlib
import io
import json
import zipfile
from pathlib import Path

from jina_real_data_validation import FILES, SOURCE_CARD, download

ARCHIVE_SHA256 = "1f1b849d2bf44d084cbc1306477cfec878d7b713dc38db93dcffbea86f9371f5"
TARGET = 2000


def select(data):
    if hashlib.sha256(data).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("Unexpected archive version")
    pool = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for filename, brand in FILES.items():
            with archive.open(filename) as raw:
                reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
                for row in reader:
                    model = " ".join(row["model"].split())
                    year, price, miles = (int(row[k]) for k in ("year", "price", "mileage"))
                    if not model or not 1886 <= year <= 2026 or price <= 0 or miles < 0:
                        continue
                    key = (brand, model, price, year, miles)
                    if key not in pool:
                        pool[key] = f"{filename}:{reader.line_num}"

    def rank(key):
        data = json.dumps(key, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(data).digest()

    rows = []
    for key in sorted(pool, key=rank)[:TARGET]:
        brand, model, price, year, miles = key
        rows.append({"source": "kaggle-uk-used-cars", "source_id": pool[key],
                     "source_url": SOURCE_CARD, "title": f"{brand} {model}", "price_gbp": price,
                     "year": year, "mileage_miles": miles})
    if len(rows) != TARGET:
        raise ValueError("Incomplete historical sample")
    return {"format": "kaggle-uk-used-cars", "complete_unique": len(rows), "rows": rows}


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("output", type=Path)
    cli.add_argument("--archive", type=Path, help="reuse the published ZIP without network access")
    args = cli.parse_args()
    blob = args.archive.read_bytes() if args.archive else download({"dataset_download": {}})
    report = select(blob)
    args.output.write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")) + "\n",
                           encoding="utf-8")
