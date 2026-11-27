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

        def dom(key, batch, status="listing", model="Clio", at=observation, criteria=(), evidence_digest=None, **fields):
            url = "https://www.leboncoin.fr/ad/voitures/" + key
            raw = (batch + key + at.isoformat()).encode()
            digest = hashlib.sha256(raw).hexdigest()
            observed_fields = {"brand": "Renault", "model": model, "model_year": 2021, **fields}
            normal = {"status": status, "source": {"original_url": url, "listing_id": key, "name": "leboncoin"},
                      "schema_version": "leboncoin-replay/v1", "observation_sha256": evidence_digest or digest, "photos": {"status": "observed", "values": []},
                      "criteria": [{"key": name, "label": label, "value": value, "evidence": {
                          "raw": value, "selector": 'main [data-qa-id^="criteria_item_"]',
                          "json_pointer": f"/criteria/{index}/value", "observation_sha256": evidence_digest or digest}}
                          for index, (name, label, value) in enumerate(criteria)],
                      "fields": {k: {"status": "observed", "value": v} for k, v in observed_fields.items()}}
            cur.execute(f"INSERT INTO {schema}.batches VALUES (%s,'','','','',%s,'{{}}') ON CONFLICT DO NOTHING",
                        (batch, at))
            cur.execute(f"INSERT INTO {schema}.raw_observations VALUES (%s,'leboncoin',%s,%s,%s,%s,%s)",
                        (digest, key, url, at, raw, len(raw)))
            cur.execute(f"INSERT INTO {schema}.observations VALUES (%s,%s)", (digest, json.dumps(normal)))
            cur.execute(f"INSERT INTO {schema}.batch_entries VALUES (%s,%s,%s,%s)", (batch,key,digest,digest))

        def export(rows, at):
            raw = json.dumps([{"source_listing_id": key, "at": at.isoformat()} for key, _, _ in rows]).encode()
            digest = hashlib.sha256(raw).hexdigest()
            until = observation + 10 * hour
            values = [{"source_listing_id": key, "brand": "Renault", "model": "Clio", "year": 2020,
                       "price_amount_minor": cents, "mileage_km": None, "images": photos,
                       "media_observed_at": at.isoformat() if photos is not None else None,
                       "media_retain_until": until.isoformat() if photos is not None else None}
                      for key, photos, cents in rows]
            cur.execute(f"""INSERT INTO {fixtures.TABLE} (export_sha256,raw_bytes,exported_at,retain_until,row_count,listings)
                            VALUES (%s,%s,%s,%s,%s,%s)""", (digest, raw, at, until, len(rows), json.dumps(values)))
            return digest

        facts = {"price": {"currency": "EUR", "amountMinor": 1_200_001}, "mileage": {"unit": "km", "amount": 50_000}}
        details = [("fuel", "Énergie", "Essence"), ("gearbox", "Boîte de vitesse", "Automatique"),
                   ("vehicle_type", "Type de véhicule", "4x4, SUV, Crossover & Pick-up"),
                   ("vehicule_color", "Couleur", "Gris"), ("vehicle_upholstery", "Sellerie", "Tout cuir"),
                   ("doors", "Nombre de portes", "5"), ("seats", "Nombre de place(s)", "5"),
                   ("vehicle_history", "Historique du véhicule", "Première main"),
                   ("vehicle_maintenance", "Entretien du véhicule", "Carnet d'entretien disponible, Factures disponibles"),
                   ("vehicle_technical_inspection_valid", "Contrôle technique valide", "Non")]
        dom("100", admitted_dom, criteria=details, **facts)
        dom("200", private_dom, criteria=details, **facts)
        dom("300", admitted_dom, model=vin, brand="Audi", model_year="2021", mileage={"unit": "mi", "amount": 5},
            criteria=[("fuel", "Énergie", "Diesel"), ("fuel", "Énergie", "Essence"), ("vehicule_color", "Couleur", vin),
                      ("gearbox", "Autre libellé", "Automatique"), ("doors", "Nombre de portes", "5 portes"),
                      ("vehicle_maintenance", "Entretien du véhicule", "Carnet d'entretien disponible, " + vin)],
            price={"currency": "USD", "amountMinor": 500_000})
        private_export = export([("400", [fixtures.PHOTO], 150_000), ("500", [fixtures.PHOTO], 90_000),
                                 ("600", None, None)], observation)
        admitted_export = export([("400", None, None), ("700", [fixtures.PHOTO], 1_500_000)], observation + hour)
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
                self.assertEqual(set(page("brand=renault&model=cLiO")), {"100", "400", "700"})
                self.assertEqual(set(page("brand=Audi&model=" + vin)), set())
                self.assertEqual(set(page("brand=Renault&model=Yaris")), set())
                # Earlier views don't attest which source observation owns the criteria.
                self.assertIsNone(detail("100")[1]["fuel"])
                self.assertEqual(page("fuel=Essence"), {})
                cur.execute(f"""CREATE OR REPLACE VIEW {schema}.catalog_dom_provenance WITH (security_barrier = true) AS
                                SELECT l.source_id, l.source_listing_id, l.original_url, l.captured_at, l.normalized_json,
                                    ARRAY(SELECT b.batch_id FROM {schema}.batch_entries b
                                          WHERE b.observation_sha256 = l.observation_sha256
                                            AND b.source_listing_id = l.source_listing_id) AS batch_ids,
                                    l.observation_sha256 AS listing_observation_sha256
                                FROM {schema}.latest_listings l""")
                observed = detail("100")[1]
                self.assertEqual([observed[key] for key in ("fuel", "gearbox", "body", "color", "upholstery", "doors", "seats",
                                                            "firstOwner", "inspectionValid", "serviceBook")],
                                 ["Essence", "Automatique", "SUV, 4x4 et pick-up", "Gris", "Tout cuir", 5, 5, True, False, True])
                self.assertEqual(set(page("fuel=essence&gearbox=Automatique&body=SUV%2C+4x4+et+pick-up&color=gris"
                                          "&upholstery=Tout+cuir&doors=5&seatsMin=5&seatsMax=5&firstOwner=1&serviceBook=1")), {"100"})
                self.assertEqual(set(page("inspectionValid=1")), set())
                self.assertEqual(set(page("seatsMax=4")), set())
                self.assertEqual(set(page("fuel=Diesel")), set())
                self.assertEqual(set(page("color=" + vin)), set())
                invalid = detail("300")[1]
                self.assertTrue(all(invalid[key] is None for key in ("fuel", "gearbox", "color", "doors", "serviceBook")))
                self.assertEqual(set(page("priceMin=12000&priceMax=12001")), {"100"})
                self.assertEqual(set(page("priceMax=12000")), set())
                self.assertEqual(set(page("priceMin=0")), {"100", "700"})
                self.assertEqual(set(page("kmMax=50000")), {"100"})
                self.assertEqual(set(page("kmMax=49999")), set())
                self.assertEqual(set(page("brand=Renault&model=Clio&kmMin=50000&kmMax=50000")), {"100"})
                self.assertEqual(set(page("kmMin=50001")), set())
                self.assertEqual(set(page("kmMin=0")), {"100"})
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
                self.assertEqual(set(page("hasPhotos=1&limit=1")), {"700"})
                self.assertEqual(set(page("brand=Renault&model=Clio&hasPhotos=1&hasPrice=1")), {"700"})
                dom("800", admitted_dom, price={"currency": "EUR", "amountMinor": 0})
                priced = page("hasPrice=1")
                self.assertEqual({key: item["price_amount_minor"] for key, item in priced.items()},
                                 {"100": 1_200_001, "700": 1_500_000, "800": 0})
                self.assertEqual(set(page("hasPrice=1&brand=Renault&priceMax=0")), {"800"})
                self.assertEqual(set(page("hasPrice=1&brand=Audi")), set())
                filtered = reader.read(reader.LIST, "hasPrice=1&limit=1&after=100")[1]
                self.assertEqual([row["source_listing_id"] for row in filtered["items"]], ["700"])
                self.assertEqual(filtered["next_cursor"], "700")
                self.assertIsNone(detail("700")[1]["fuel"])
                # A self-consistent normalized document from another observation must not attach its fuel here.
                dom("880", admitted_dom, criteria=[("fuel", "Énergie", "Diesel")], evidence_digest="d" * 64)
                self.assertEqual(detail("880")[0], "200 OK")
                self.assertIsNone(detail("880")[1]["fuel"])
                self.assertEqual(page("fuel=Diesel"), {})
                # Exercise a forward-compatible Rust projection using the existing read-only role.
                cur.execute(f"ALTER VIEW {schema}.catalog_rust_provenance RENAME TO rust_provenance_fixture")
                accepted_native = {"fuel": "Diesel", "gearbox": "Automatique", "doors": 3, "seats": 4,
                                   "firstOwner": True, "inspectionValid": False, "serviceBook": "Oui", "body": vin}
                cur.execute(f"""CREATE VIEW {schema}.catalog_rust_provenance WITH (security_barrier = true) AS
                                SELECT r.*, CASE WHEN source_listing_id = '700' THEN %s::jsonb END AS vehicle_features
                                FROM {schema}.rust_provenance_fixture r""", (json.dumps(accepted_native),))
                cur.execute(f"GRANT SELECT ON {schema}.catalog_rust_provenance TO af_rust_export_reader")
                self.assertEqual(set(page("fuel=diesel&gearbox=Automatique&doors=3&seatsMin=4&firstOwner=1")), {"700"})
                self.assertEqual(set(page("fuel=Diesel&serviceBook=1")), set())
                self.assertEqual(set(page("body=" + vin)), set())
                self.assertIsNone(detail("700")[1]["body"])
                self.assertIsNone(detail("700")[1]["serviceBook"])
                self.assertIs(detail("700")[1]["inspectionValid"], False)
                gallery = [fixtures.PHOTO.replace("a" * 40, f"{i:040x}") for i in range(14)]
                bulk = export([(str(40000 + i), gallery, None) for i in range(1000)], observation)
                grant["export_ids"].append(bulk)
                self.assertEqual(set(page("fuel=Diesel&gearbox=Automatique&hasPhotos=1&limit=1")), {"700"})
                grant["export_ids"].remove(bulk)
                cur.execute(f"DELETE FROM {fixtures.TABLE} WHERE export_sha256 = %s", (bulk,))
                cur.execute(f"DROP VIEW {schema}.catalog_rust_provenance")
                cur.execute(f"ALTER VIEW {schema}.rust_provenance_fixture RENAME TO catalog_rust_provenance")
                grant["export_ids"].append(private_export)
                self.assertEqual(detail("400")[1]["images"], [fixtures.PHOTO])
                self.assertIn("400", page("hasPhotos=1"))
                grant["export_ids"].remove(admitted_export)
                self.assertEqual(detail("400")[0], "404 Not Found")
                self.assertNotIn("400", page("hasPhotos=1"))
                dom("100", private_dom, status="not_available", at=observation + 2*hour)
                self.assertEqual(detail("100")[0], "404 Not Found")
                grant.update(export_ids=[], dom_batch_ids=[])
                self.assertEqual(page(), {})
        cur.execute((migrations / "0004-catalog-provenance.down.sql").read_text())
        cur.execute(f"SELECT count(*) FROM {fixtures.VIEW}")
        self.assertEqual(cur.fetchone()[0], 4)
