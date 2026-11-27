"""Upgrade/downgrade against the same isolated PostgreSQL fixture as the private catalogue."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import runpy

import psycopg2

import test_native_migration as fixtures


class VehicleFeaturesMigrationTests(fixtures.NativeMigrationTests):
    def check_contract(self, cur):
        schema = fixtures.SCHEMA
        view = schema + ".catalog_rust_provenance"
        dom_view = schema + ".catalog_dom_provenance"
        ddl = fixtures.historical_ddl()
        migrations = fixtures.HERE / "migrations"
        up = (migrations / "0005-rust-vehicle-features.up.sql").read_text()
        down = (migrations / "0005-rust-vehicle-features.down.sql").read_text()
        for version, source, migration in (
                (1, "vehicle_labels.json", up), (2, "vehicle_labels_v2.json", up), (1, "vehicle_labels.json", down)):
            pattern = rf"\$labels_v{version}\$(.*?)\$labels_v{version}\$"
            embedded = re.findall(pattern, migration, re.DOTALL)
            self.assertEqual(len(embedded), 1)
            self.assertEqual(json.loads(embedded[0]), json.loads((fixtures.HERE / source).read_text()))
        cur.execute("BEGIN;" + ddl + "COMMIT;")
        cur.execute(f"INSERT INTO {schema}.metadata VALUES ('schema',%s)",
                    ("leboncoin-private-trial/v1:" + hashlib.sha256(ddl.encode()).hexdigest(),))
        cur.execute((migrations / "0002-legacy-catalog-media-history.up.sql").read_text())
        cur.execute(fixtures.UP)
        cur.execute((migrations / "0004-catalog-provenance.up.sql").read_text())
        cur.execute(f"""CREATE ROLE fixture_features_reader;
                        CREATE ROLE fixture_features_writer;
                        GRANT USAGE ON SCHEMA {schema} TO fixture_features_reader, fixture_features_writer;
                        GRANT INSERT,SELECT ON {fixtures.TABLE} TO fixture_features_writer;
                        GRANT SELECT ON {view}, {dom_view} TO fixture_features_reader WITH GRANT OPTION;
                        CREATE VIEW public.preexisting_consumer AS SELECT source_listing_id, listing_export FROM {view};
                        CREATE VIEW public.preexisting_dom_consumer AS SELECT source_listing_id FROM {dom_view}""")

        def identity():
            cur.execute("""SELECT oid,relowner,relacl,reloptions FROM pg_class
                           WHERE oid IN (%s::regclass,%s::regclass) ORDER BY oid""", (view, dom_view))
            return cur.fetchall()

        original = identity()
        origin = datetime.now(timezone.utc) - timedelta(days=3)
        hour = timedelta(hours=1)
        expiry = origin + timedelta(days=30)
        dom_body = b"offline DOM observation"
        dom_digest = hashlib.sha256(dom_body).hexdigest()
        claimed_digest = "0" * 64
        cur.execute(f"INSERT INTO {schema}.raw_observations VALUES (%s,'leboncoin','23',%s,%s,%s,%s)",
                    (dom_digest, "https://www.leboncoin.fr/ad/voitures/23", origin, dom_body, len(dom_body)))
        cur.execute(f"INSERT INTO {schema}.observations VALUES (%s,%s)",
                    (dom_digest, json.dumps({"observation_sha256": claimed_digest})))
        seq = 0

        def insert(key, attributes=None, *, proof=None, version=2, raw_fields=None, projected_fields=None,
                   at=origin, until=expiry):
            nonlocal seq
            seq += 1
            raw_item = {"index": seq, "source_listing_id": key}
            row = {"source_listing_id": key}
            if attributes is not None:
                if version is not None:
                    row["vehicle_labels_version"] = version
                row["vehicle_features"] = attributes
                raw_item["vehicle_features_evidence"] = {"schema": "searchData.ads.offer.features/v1",
                                                         "list_id": key, "attributes": attributes}
            if proof is not None:
                raw_item["vehicle_features_evidence"] = proof
            raw_item.update(raw_fields or {})
            row.update(projected_fields or {})
            data = json.dumps([raw_item]).encode()
            digest = hashlib.sha256(data).hexdigest()
            cur.execute(f"""INSERT INTO {fixtures.TABLE}(export_sha256,raw_bytes,exported_at,retain_until,row_count,listings)
                            VALUES (%s,%s,%s,%s,1,%s)""", (digest, data, at, until, json.dumps([row])))
            return digest

        def model_proof(key):
            return {"schema": "searchData.ads.offer.model/v1", "list_id": key, "brand": "Tesla", "model": "Model 3"}

        def native_model(key):
            return {"marque": "Tesla", "modele": "Model 3", "vehicle_model_evidence": model_proof(key)}

        def native_price(key, euros="12950", cents=1295000):
            return {"prix": euros, "sale_price_evidence": {"schema": "searchData.ads.offer.price/v1",
                    "list_id": key, "currency": "EUR", "amount_minor": cents}}

        projected_model = {"vehicle_labels_version": 2, "brand": "Tesla", "model": "Model 3"}
        insert("11", raw_fields={"marque": "Renault", "modele": "Clio IV", "prix": "799"},
               projected_fields={"brand": "Renault", "model": "Clio"})
        historical_paid = insert("13", raw_fields=native_price("13"), projected_fields={"price_amount_minor": 1295000},
                                 until=origin + hour)
        cur.execute(f"SELECT to_jsonb(r)->'vehicle_features' FROM {view} r")
        self.assertIsNone(cur.fetchone()[0])
        # A noncanonical JSON field inserted outside the importer before migration must not be published.
        bad = insert("99", {"color": "free text"})
        with self.assertRaisesRegex(psycopg2.Error, "invalid_existing_vehicle_features"):
            cur.execute(up)
        cur.execute("ROLLBACK")
        self.assertEqual(original, identity())
        cur.execute(f"DELETE FROM {fixtures.TABLE} WHERE export_sha256=%s", (bad,))
        # A proof in the raw archive itself requires v2, even when no marker or features
        # in the projection reveal that the archive contains the new contract.
        bad_model = insert("99", raw_fields=native_model("99"), projected_fields={"brand": "Tesla", "model": "Model 3"})
        with self.assertRaisesRegex(psycopg2.Error, "invalid_existing_vehicle_features"):
            cur.execute(up)
        cur.execute("ROLLBACK")
        cur.execute(f"DELETE FROM {fixtures.TABLE} WHERE export_sha256=%s", (bad_model,))
        for raw_price, projection in (({}, {"price_amount_minor": 1295000}),
                                      ({"marque": "Tesla", "modele": "Model 3"}, projected_model),
                                      (native_price("99", euros="1295"), {"price_amount_minor": 1295000})):
            forged_before_upgrade = insert("99", raw_fields=raw_price, projected_fields=projection)
            with self.assertRaisesRegex(psycopg2.Error, "invalid_existing_vehicle_features"):
                cur.execute(up)
            cur.execute("ROLLBACK")
            cur.execute(f"DELETE FROM {fixtures.TABLE} WHERE export_sha256=%s", (forged_before_upgrade,))
        cur.execute(up)
        cur.execute(up)
        self.assertEqual(original, identity())

        # Both endpoints and the database accept the complete, same set of filter values.
        from project_export import FEATURE_FLAGS, FEATURE_LABELS
        reader_path = fixtures.HERE.parents[2] / "services/private-catalog/catalog_reader.py"
        reader = runpy.run_path(str(reader_path))
        self.assertEqual(FEATURE_LABELS, {key: set(values) for key, values in reader["FILTER_OPTIONS"].items()})
        self.assertEqual(FEATURE_FLAGS, set(reader["EQUIPMENT_FLAGS"]))
        raw_ids = [{"source_listing_id": "55"}, {"source_listing_id": "56"}]
        mixed = [raw_ids[0] | {"vehicle_labels_version": 2}, raw_ids[1]]
        cur.execute(f"SELECT {schema}.valid_rust_vehicle_evidence(%s,%s)",
                    (json.dumps(raw_ids).encode(), json.dumps(mixed)))
        self.assertFalse(cur.fetchone()[0])
        # Model evidence is independent of technical features and is joined by ID, not array position.
        first_model = native_model("55") | raw_ids[0]
        next_model = {"source_listing_id": "56", "marque": "Dacia", "modele": "Sandero",
                      "vehicle_model_evidence": model_proof("56") | {"brand": "Dacia", "model": "Sandero"}}
        model_rows = [{**projected_model, "source_listing_id": "56", "brand": "Dacia", "model": "Sandero"},
                      {**projected_model, "source_listing_id": "55"}]
        cur.execute(f"SELECT {schema}.valid_rust_vehicle_evidence(%s,%s)",
                    (json.dumps([first_model, next_model]).encode(), json.dumps(model_rows)))
        self.assertTrue(cur.fetchone()[0])
        model_rows[0]["model"], model_rows[1]["model"] = model_rows[1]["model"], model_rows[0]["model"]
        cur.execute(f"SELECT {schema}.valid_rust_vehicle_evidence(%s,%s)",
                    (json.dumps([first_model, next_model]).encode(), json.dumps(model_rows)))
        self.assertFalse(cur.fetchone()[0])
        for name, values in FEATURE_LABELS.items():
            for value in values:
                attributes = {name: value}
                raw = [{"source_listing_id": "55", "vehicle_features_evidence": {
                    "schema": "searchData.ads.offer.features/v1", "list_id": "55", "attributes": attributes}}]
                row = [{"source_listing_id": "55", "vehicle_labels_version": 2, "vehicle_features": attributes}]
                cur.execute(f"SELECT {schema}.valid_rust_vehicle_evidence(%s,%s)",
                            (json.dumps(raw).encode(), json.dumps(row)))
                self.assertTrue(cur.fetchone()[0], (name, value))
        cur.execute("SET ROLE fixture_features_writer")
        supported = {"fuel": "Diesel", "gearbox": "Manuelle", "doors": 3, "seats": 5,
                     "firstOwner": True, "inspectionValid": False}
        digest = insert("22", supported, raw_fields=native_model("22") | native_price("22"),
                        projected_fields=projected_model | {"price_amount_minor": 1295000})
        insert("33", {"body": "Coupé"}, until=origin + hour)
        first = insert("44", {"color": "Gris", "serviceBook": True})
        second = insert("44", {"fuel": "Essence"}, at=origin + hour)
        forged = {"schema": "searchData.ads.offer.features/v1", "list_id": "88", "attributes": {"seats": 4}}
        for attrs, raw in (({"seats": 5}, forged), ({"seats": 4}, forged | {"list_id": "87"}), (None, forged),
                           ({"seats": 4}, forged | {"attributes": {"seats": 4.0}}),
                           ({"gearbox": ["Manuelle"]}, None), ({"fuel": "other"}, None), ({}, None),
                           ({"doors": True}, None), ({"doors": 5.0}, None), ({"firstOwner": 1}, None),
                           ({"upholstery": "free text"}, None), ({"description": "hidden"}, None)):
            with self.subTest(attrs=attrs, raw=raw), self.assertRaisesRegex(psycopg2.Error, "invalid_native_vehicle_features"):
                insert("88", attrs, proof=raw)
        for version in (None, True, 2.0, "2", 3):
            with self.subTest(version=version), self.assertRaisesRegex(psycopg2.Error, "invalid_native_vehicle_features"):
                insert("88", {"doors": 4}, version=version)
        native = native_model("88")
        evidence = model_proof("88")
        for label, raw_fields, projected_fields in (
            ("missing brand", {k: v for k, v in native.items() if k != "marque"}, projected_model),
            ("missing model", {k: v for k, v in native.items() if k != "modele"}, projected_model),
            ("wrong row brand", native | {"marque": "Dacia"}, projected_model),
            ("wrong row model", native | {"modele": "Model Y"}, projected_model),
            ("wrong projected model", native, projected_model | {"model": "Model Y"}),
            ("wrong projected brand", native, projected_model | {"brand": "Dacia"}),
            ("no projected model", native, {"brand": "Tesla", "vehicle_labels_version": 2}),
            ("empty strings", dict(marque="", modele="", vehicle_model_evidence=evidence | {"brand": "", "model": ""}),
             projected_model | {"brand": "", "model": ""}),
            ("numeric model throughout", native | {"modele": 3, "vehicle_model_evidence": evidence | {"model": 3}},
             projected_model | {"model": 3}),
            ("numeric ID throughout", native | {"source_listing_id": 88, "vehicle_model_evidence": evidence | {"list_id": 88}},
             projected_model | {"source_listing_id": 88}),
        ):
            with self.subTest(label=label), self.assertRaisesRegex(psycopg2.Error, "invalid_native_vehicle_features"):
                insert("88", raw_fields=raw_fields, projected_fields=projected_fields)
        for bad_proof in (None, [], evidence | {"extra": True}, evidence | {"schema": "other"},
                          evidence | {"list_id": "22"}, evidence | {"list_id": 88}, evidence | {"model": False},
                          evidence | {"brand": "Dacia"}):
            with self.subTest(model_evidence=bad_proof), self.assertRaisesRegex(psycopg2.Error, "invalid_native_vehicle_features"):
                insert("88", raw_fields=native | {"vehicle_model_evidence": bad_proof}, projected_fields=projected_model)
        for marker in (None, False, 2.0, "2"):
            with self.subTest(marker=marker), self.assertRaisesRegex(psycopg2.Error, "invalid_native_vehicle_features"):
                insert("88", raw_fields=native, projected_fields=projected_model | {"vehicle_labels_version": marker})
        for raw_fields, projected_fields in (
            ({"marque": "Tesla", "modele": "Model 3"}, projected_model),
            ({"marque": "Tesla", "modele": "Model 3"}, {"brand": "Tesla", "model": "Model 3"}),
            ({"marque": "Renault"}, {"brand": "Renault", "model": "Clio"}),
            (native | {"modele": "unlisted", "vehicle_model_evidence": evidence | {"model": "unlisted"}},
             projected_model | {"model": "unlisted"}),
        ):
            with self.subTest(raw=raw_fields), self.assertRaisesRegex(psycopg2.Error, "invalid_native_vehicle_features"):
                insert("88", raw_fields=raw_fields, projected_fields=projected_fields)
        price = native_price("88")
        sale = price["sale_price_evidence"]
        projected_price = {"price_amount_minor": 1295000}
        for label, raw_fields, projected_fields in (
            ("no proof", {"prix": "12950"}, projected_price), ("no projected price", price, {}),
            ("null projected price", price, {"price_amount_minor": None}),
            ("different projected amount", price, {"price_amount_minor": 129500}),
            ("different offer", price | {"sale_price_evidence": sale | {"list_id": "87"}}, projected_price),
            ("numeric offer ID", price | {"sale_price_evidence": sale | {"list_id": 88}}, projected_price),
            ("foreign currency", price | {"sale_price_evidence": sale | {"currency": "USD"}}, projected_price),
            ("different euros", price | {"prix": "1295"}, projected_price),
            ("numeric euros", price | {"prix": 12950}, projected_price),
            ("noncanonical euros", price | {"prix": "012950"}, projected_price),
            ("schema", price | {"sale_price_evidence": sale | {"schema": "other"}}, projected_price),
            ("extra", price | {"sale_price_evidence": sale | {"extra": "x"}}, projected_price),
            ("float cents", native_price("88", cents=1295000.0), projected_price),
            ("string cents", native_price("88", cents="1295000"), projected_price),
            ("boolean cents", native_price("88", cents=True), projected_price),
            ("fractional euros", native_price("88", cents=1295001), {"price_amount_minor": 1295001}),
            ("zero", native_price("88", euros="0", cents=0), {"price_amount_minor": 0}),
            ("too large", native_price("88", euros="90071992547410", cents=9007199254741000),
             {"price_amount_minor": 9007199254741000}),
        ):
            with self.subTest(label=label), self.assertRaisesRegex(psycopg2.Error, "invalid_native_vehicle_features"):
                insert("88", raw_fields=raw_fields, projected_fields=projected_fields)
        cur.execute("RESET ROLE")
        by_id = {"source_listing_id": "88"}
        raw_price = json.dumps([by_id | price]).replace("1295000", "1.295e6")
        cur.execute(f"SELECT {schema}.valid_rust_vehicle_evidence(%s,%s)",
                    (raw_price.encode(), json.dumps([by_id | projected_price])))
        self.assertFalse(cur.fetchone()[0])
        # The private importer rejects duplicate JSON fields and floating-point feature counts.
        raw_duplicate = json.dumps([by_id | price]).replace('"currency": "EUR"', '"currency": "CHF", "currency": "EUR"')
        cur.execute(f"SELECT {schema}.valid_rust_vehicle_evidence(%s,%s)",
                    (raw_duplicate.encode(), json.dumps([by_id | projected_price])))
        self.assertFalse(cur.fetchone()[0])
        raw_count = json.dumps([by_id | {"vehicle_features_evidence": {
            "schema": "searchData.ads.offer.features/v1", "list_id": "88", "attributes": {"doors": 5}}}])
        raw_count = raw_count.replace('"doors": 5', '"doors": 5e0')
        typed_count = [by_id | {"vehicle_labels_version": 2, "vehicle_features": {"doors": 5}}]
        cur.execute(f"SELECT {schema}.valid_rust_vehicle_evidence(%s,%s)", (raw_count.encode(), json.dumps(typed_count)))
        self.assertFalse(cur.fetchone()[0])
        cur.execute(f"SELECT listings FROM {fixtures.TABLE} WHERE export_sha256=%s", (historical_paid,))
        self.assertEqual(cur.fetchone()[0], [{"source_listing_id": "13", "price_amount_minor": 1295000}])
        # JSONB considers integers equal to numerically equivalent decimals. Neither
        # a relabelled version nor a retyped price can be smuggled into an UPDATE.
        for field, numeric in (("vehicle_labels_version", "2.0"), ("price_amount_minor", "1295000.0")):
            with self.subTest(field=field), self.assertRaisesRegex(psycopg2.Error, "immutable_native_export"):
                cur.execute(f"UPDATE {fixtures.TABLE} SET listings=jsonb_set(listings, %s, %s::jsonb) WHERE export_sha256=%s",
                            (["0", field], numeric, digest))
        cur.execute("SET ROLE fixture_features_reader")
        cur.execute(f"SELECT brand,model FROM {view} WHERE source_listing_id IN ('11','22') ORDER BY source_listing_id")
        self.assertEqual(cur.fetchall(), [("Renault", "Clio"), ("Tesla", "Model 3")])
        cur.execute(f"SELECT listing_observation_sha256,normalized_json->>'observation_sha256' FROM {dom_view}")
        self.assertEqual(cur.fetchone(), (dom_digest, claimed_digest))
        cur.execute(f"SELECT has_table_privilege(current_user,'{fixtures.TABLE}','SELECT'),"
                    f"has_function_privilege(current_user,'{schema}.valid_rust_vehicle_evidence(bytea,jsonb)','EXECUTE')")
        self.assertEqual(cur.fetchone(), (False, False))
        cur.execute(f"SELECT source_listing_id,listing_export,vehicle_features FROM {view} ORDER BY 1")
        rows = cur.fetchall()
        self.assertEqual(rows[0][0], "11")
        self.assertIsNone(rows[0][2])
        self.assertEqual(rows[1:], [("22", digest, supported), ("44", second, {"fuel": "Essence"})])
        cur.execute("RESET ROLE")
        cur.execute(f"UPDATE {fixtures.TABLE} SET suppressed_listings=ARRAY['44'] WHERE export_sha256 IN (%s,%s)",
                    (first, second))
        cur.execute(f"SELECT count(*) FROM {view} WHERE source_listing_id='44'")
        self.assertEqual(cur.fetchone(), (0,))
        cur.execute(down)
        cur.execute(down)
        self.assertEqual(original, identity())
        cur.execute("SET ROLE fixture_features_reader")
        cur.execute(f"SELECT source_listing_id,vehicle_features FROM {view} ORDER BY 1")
        self.assertEqual(cur.fetchall(), [("11", None), ("22", None)])
        cur.execute(f"SELECT brand,model,price_amount_minor FROM {view} WHERE source_listing_id='11'")
        self.assertEqual(cur.fetchone(), ("Renault", "Clio", None))
        cur.execute(f"SELECT model,price_amount_minor FROM {view} WHERE source_listing_id='22'")
        self.assertEqual(cur.fetchone(), (None, 1295000))
        cur.execute(f"SELECT listing_observation_sha256 FROM {dom_view}")
        self.assertIsNone(cur.fetchone()[0])
        cur.execute("RESET ROLE")
        cur.execute("SELECT count(*) FROM public.preexisting_consumer")
        self.assertEqual(cur.fetchone(), (2,))
        cur.execute("SELECT source_listing_id FROM public.preexisting_dom_consumer")
        self.assertEqual(cur.fetchone(), ("23",))
        cur.execute(up)
        cur.execute(f"SELECT vehicle_features FROM {view} WHERE source_listing_id='22'")
        self.assertEqual(cur.fetchone(), (supported,))
        cur.execute(f"SELECT brand,model,price_amount_minor FROM {view} WHERE source_listing_id='22'")
        self.assertEqual(cur.fetchone(), ("Tesla", "Model 3", 1295000))
