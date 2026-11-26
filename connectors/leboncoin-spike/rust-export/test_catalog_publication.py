"""Exercise the product reader and its role against the isolated original PostgreSQL DDL."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

import test_native_migration as fixtures

sys.path.insert(0, str(fixtures.HERE.parents[2] / "services/private-catalog"))
import catalog_reader as reader


class CatalogPublicationTests(fixtures.NativeMigrationTests):
    def check_contract(self, cur):
        schema = fixtures.SCHEMA
        ddl = fixtures.historical_ddl()
        cur.execute("BEGIN;" + ddl + "COMMIT;")
        cur.execute(f"INSERT INTO {schema}.metadata VALUES ('schema',%s)",
                    ("leboncoin-private-trial/v1:" + hashlib.sha256(ddl.encode()).hexdigest(),))
        migrations = fixtures.HERE / "migrations"
        cur.execute((migrations / "0002-legacy-catalog-media-history.up.sql").read_text())
        cur.execute(fixtures.UP)
        cur.execute((migrations / "0004-catalog-provenance.up.sql").read_text())
        cur.execute(f"""CREATE ROLE af_rust_export_reader LOGIN;
                       GRANT USAGE ON SCHEMA {schema} TO af_rust_export_reader;
                       GRANT SELECT ON {schema}.catalog_dom_provenance, {schema}.catalog_rust_provenance,
                           {schema}.catalog_media_history TO af_rust_export_reader""")
        cur.execute(f"SELECT has_table_privilege('af_rust_export_reader','{fixtures.TABLE}','SELECT')")
        self.assertFalse(cur.fetchone()[0])
        observation = datetime.now(timezone.utc) - timedelta(hours=3)
        hour = timedelta(hours=1)
        admitted_dom, private_dom = "a" * 32, "b" * 32
        vin = "WAUZZZ8V1GA123456"

        def dom(key, batch, status="listing", model="Clio", at=observation, **fields):
            url = "https://www.leboncoin.fr/ad/voitures/" + key
            raw = (batch + key + at.isoformat()).encode()
            digest = hashlib.sha256(raw).hexdigest()
            observed_fields = {"brand": "Renault", "model": model, "model_year": 2021, **fields}
            normal = {"status": status, "source": {"original_url": url, "listing_id": key, "name": "leboncoin"},
                      "schema_version": "leboncoin-replay/v1", "photos": {"status": "observed", "values": []},
                      "fields": {k: {"status": "observed", "value": v} for k, v in observed_fields.items()}}
            cur.execute(f"INSERT INTO {schema}.batches VALUES (%s,'','','','',%s,'{{}}') ON CONFLICT DO NOTHING",
                        (batch, at))
            cur.execute(f"INSERT INTO {schema}.raw_observations VALUES (%s,'leboncoin',%s,%s,%s,%s,%s)",
                        (digest, key, url, at, raw, len(raw)))
            cur.execute(f"INSERT INTO {schema}.observations VALUES (%s,%s)", (digest, json.dumps(normal)))
            cur.execute(f"INSERT INTO {schema}.batch_entries VALUES (%s,%s,%s,%s)", (batch,key,digest,digest))

        def export(rows, at):
            raw = json.dumps([{"source_listing_id": key, "at": at.isoformat()} for key, _ in rows]).encode()
            digest = hashlib.sha256(raw).hexdigest()
            until = observation + 10 * hour
            values = [{"source_listing_id": key, "brand": "Renault", "model": "Clio", "year": 2020,
                       "price_amount_minor": None, "mileage_km": None, "images": photos,
                       "media_observed_at": at.isoformat() if photos is not None else None,
                       "media_retain_until": until.isoformat() if photos is not None else None}
                      for key, photos in rows]
            cur.execute(f"""INSERT INTO {fixtures.TABLE} (export_sha256,raw_bytes,exported_at,retain_until,row_count,listings)
                            VALUES (%s,%s,%s,%s,%s,%s)""", (digest, raw, at, until, len(rows), json.dumps(values)))
            return digest

        facts = {"price": {"currency": "EUR", "amountMinor": 1_200_001}, "mileage": {"unit": "km", "amount": 50_000}}
        dom("100", admitted_dom, **facts)
        dom("200", private_dom, **facts)
        dom("300", admitted_dom, model=vin, brand="Audi", model_year="2021", mileage={"unit": "mi", "amount": 5})
        private_export = export([("400",[fixtures.PHOTO]), ("500",[fixtures.PHOTO]), ("600",None)], observation)
        admitted_export = export([("400",None), ("700",[fixtures.PHOTO])], observation + hour)
        grant = {"valid_from": observation - hour, "valid_until": observation + 10*hour,
                 "media_seconds": 86400, "normalized_seconds": 86400,
                 "dom_batch_ids": [admitted_dom], "export_ids": [admitted_export]}
        with tempfile.TemporaryDirectory() as temp:
            servicefile = Path(temp) / "pg_service.conf"
            servicefile.write_text("[af_rust_export_reader]\nuser=af_rust_export_reader\ndbname=autoworld\nhost="
                                   + cur.connection.info.host + "\n")
            with patch.dict(os.environ, {"PGSERVICEFILE": str(servicefile)}), patch.object(reader, "publication_grant", return_value=grant):
                def page(query=""):
                    status, body = reader.read(reader.LIST, query)
                    self.assertEqual(status, "200 OK")
                    return {row["source_listing_id"]: row for row in body["items"]}

                def detail(key):
                    return reader.read(reader.LIST + "/" + key, "")

                self.assertEqual(set(page()), {"100", "300", "400", "700"})
                self.assertEqual(set(page("q=Clio")), {"100", "400", "700"})
                self.assertEqual(page("q=" + vin), {})
                self.assertEqual(set(page("brand=Audi&limit=1")), {"300"})
                self.assertEqual(set(page("q=Clio&brand=audi")), set())
                self.assertEqual(set(page("priceMin=12000&priceMax=12001")), {"100"})
                self.assertEqual(set(page("priceMax=12000")), set())
                self.assertEqual(set(page("priceMin=0")), {"100"})
                self.assertEqual(set(page("kmMax=50000")), {"100"})
                self.assertEqual(set(page("kmMax=49999")), set())
                self.assertEqual(set(page("brand=Renault&q=Clio&yearMin=2021&yearMax=2021&kmMax=50000&priceMin=10000&priceMax=15000")), {"100"})
                first = reader.read(reader.LIST, "yearMax=2020&limit=1")[1]
                self.assertEqual([r["source_listing_id"] for r in first["items"]], ["400"])
                self.assertEqual(first["next_cursor"], "400")
                tail = reader.read(reader.LIST, "yearMax=2020&limit=1&after=400")[1]
                self.assertEqual([r["source_listing_id"] for r in tail["items"]], ["700"])
                self.assertIsNone(tail["next_cursor"])
                self.assertIsNone(page()["300"]["model"])
                self.assertIsNone(detail("300")[1]["year"])
                self.assertIsNone(detail("300")[1]["mileage_km"])
                self.assertEqual(set(page("yearMin=2021")), {"100"})
                self.assertIsNone(detail("300")[1]["model"])
                for key in ("200", "500", "600"):
                    self.assertEqual(detail(key)[0], "404 Not Found")
                self.assertEqual(detail("400")[1]["images"], [])
                self.assertEqual(detail("700")[1]["images"], [fixtures.PHOTO])
                grant["export_ids"].append(private_export)
                self.assertEqual(detail("400")[1]["images"], [fixtures.PHOTO])
                grant["export_ids"].remove(admitted_export)
                self.assertEqual(detail("400")[0], "404 Not Found")
                dom("100", private_dom, status="not_available", at=observation + 2*hour)
                self.assertEqual(detail("100")[0], "404 Not Found")
                grant.update(export_ids=[], dom_batch_ids=[])
                self.assertEqual(page(), {})
        cur.execute((migrations / "0004-catalog-provenance.down.sql").read_text())
        cur.execute(f"SELECT count(*) FROM {fixtures.VIEW}")
        self.assertEqual(cur.fetchone()[0], 4)
