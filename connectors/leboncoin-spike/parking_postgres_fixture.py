"""Build the 2,000-record synthetic PostgreSQL fixture through the real saved-page CLI."""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import marketplace_pages
from test_leparking_html import card, result_cards


def generate_fixture(output_path):
    """Generate 80 local HTML pages and verify the exact rows the CLI emits."""
    expected = {}
    with tempfile.TemporaryDirectory() as directory:
        pages = []
        for page_number in range(80):
            start = 25 * page_number
            indices = list(range(start, start + 25))
            if page_number:
                indices.append(start - 1)
            cards = []
            for index in indices:
                source_id = f"TST{index:05d}"
                relative_url = f"/voiture-occasion-detail/test-synthetique/vehicule/{source_id}.html"
                title = f"Véhicule synthétique d’essai n°{index + 1}"
                price, year, mileage = 5000 + index * 3, 2010 + index % 15, index * 27
                cards.append(card(link=relative_url, detail=relative_url, title=title,
                                  price=f"{price} €", year=str(year), km=f"{mileage} Km"))
                expected[source_id] = dict(source="leparking", source_id=source_id,
                                           source_url="https://www.leparking.fr" + relative_url,
                                           title=title, price_eur=price, year=year, mileage_km=mileage)
            path = Path(directory) / f"page-{page_number + 1:02d}.html"
            path.write_text(result_cards(*cards), encoding="utf-8")
            pages.append(str(path))
        result = subprocess.run([sys.executable, marketplace_pages.__file__, "leparking-html", "--target", "2000",
                                 "--rows", *pages], check=True, capture_output=True, timeout=60)
    report = json.loads(result.stdout)
    if not (report["complete_unique"] == report["distinct_identified"] == len(report["rows"]) == 2000
            and report["repeat_observations"] == 79
            and sum(page["observations"] for page in report["pages"]) == 2079
            and [page["new_source_ids"] for page in report["pages"]] == [25] * 80):
        raise ValueError("The synthetic pagination counts differ from their reference")
    actual = {row["source_id"]: row for row in report["rows"]}
    if actual != expected:
        raise ValueError("The synthetic record fields differ from their reference")
    Path(output_path).write_bytes(result.stdout)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("output", type=Path)
    generate_fixture(cli.parse_args().output)
