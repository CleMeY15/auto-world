"""Exercise a 1,000-URL synthetic manifest offline, with real PostgreSQL on localhost."""
import argparse
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4
import json

from mobile_batch import run_batch
from own_fetch import Response


def check(database):
    if not database.startswith("autofindex_trial_"):
        raise ValueError("Use a dedicated local trial database for synthetic data.")
    # Independent synthetic native IDs make repeated CI runs possible in the same trial DB.
    base = int(uuid4().hex[:10], 16) * 1000
    urls = [f"https://suchen.mobile.de/fahrzeuge/details.html?id={base+i}&vip=1" for i in range(1000)]
    requests = []

    def simulated_get(url, limit, **kwargs):
        requests.append(url)
        if url == "https://suchen.mobile.de/robots.txt":
            return Response(200, "text/plain", b"User-agent: *\nAllow: /")
        if url == urls[10]:
            return Response(403, "text/html", b"")
        if url not in urls[:10]:
            raise AssertionError("Unexpected synthetic request after publisher refusal.")
        canonical = url.removesuffix("&vip=1")
        html = (f'<link rel="canonical" href="{canonical}"><h1>Véhicule synthétique</h1>'
                '<p>Kaufpreis: 12.300 EUR</p><p>Erstzulassung: 03/2020</p>'
                '<p>Kilometerstand: 43.200 km</p>').encode()
        return Response(200, "text/html", html)

    with TemporaryDirectory() as tmp:
        base_path = Path(tmp)
        manifest, state = base_path / "list.txt", base_path / "state.sqlite"
        manifest.write_text("\n".join([*urls, *urls[:3]]) + "\n", encoding="utf-8")
        with patch("own_fetch.get", side_effect=simulated_get):
            first = run_batch(manifest, state, database, 0.01)
            attempts = len(requests)
            restart = run_batch(manifest, state, database, 0.01)
        expected = {"supplied":1003, "distinct_urls":1000, "verified":10, "inserted":10, "pending":990}
        if any(first.get(k) != v for k, v in expected.items()) or len(requests) != attempts or attempts != 22:
            raise AssertionError(f"Unexpected checkpoint/restart: {first}, {restart}, {len(requests)} attempts")
        if first["stop"]["http"]["detail_http"] != 403 or first != restart:
            raise AssertionError("Publisher refusal must survive a process restart.")
        return dict(synthetic=True, outbound_network_requests=0, verified_by_postgres=first["verified"],
                    manifest_lines=first["supplied"], distinct_urls=first["distinct_urls"],
                    pending_at_stop=first["pending"], simulated_stop_http=403, simulated_calls_at_restart=0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database")
    print(json.dumps(check(parser.parse_args().database)))
