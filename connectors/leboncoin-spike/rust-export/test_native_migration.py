"""Run against a disposable, network-isolated PostgreSQL with the original project DDL."""
from contextlib import closing
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

import psycopg2


HERE = Path(__file__).resolve().parent
UP = (HERE / "migrations/0003-native-rust-exports.up.sql").read_text()
DOWN = (HERE / "migrations/0003-native-rust-exports.down.sql").read_text()
SCHEMA = "aw_acquisition_trial"
VIEW = f"{SCHEMA}.rust_export_listings"
TABLE = f"{SCHEMA}.rust_exports"
PHOTO = "https://img.leboncoin.fr/api/v1/lbcpb1/images/aa/bb/cc/" + "a" * 40 + ".jpg"


def historical_ddl():
    # Verbatim POSTGRES_DDL used by the existing private import (PR 283).
    schema = (HERE / "fixtures/historical_trial_schema.sql").read_bytes()
    if hashlib.sha256(schema).hexdigest() != "6c83f9f0e4b4f482352aa9d3015782e51029e0483bb3514319a77c90bf07a495":
        raise AssertionError("historical PostgreSQL fixture changed")
    return schema.decode("utf-8")


@unittest.skipUnless(os.getenv("AUTOFIND_TEST_POSTGRES_IMAGE"), "set the digest of a local PostgreSQL image")
class NativeMigrationTests(unittest.TestCase):
    def test_existing_database_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            socket = Path(temp) / "postgres"
            socket.mkdir()
            socket.chmod(0o777)
            container = subprocess.check_output([
                "docker", "run", "-d", "--pull", "never", "--network", "none", "-v", f"{socket}:/socket",
                "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=autoworld",
                os.environ["AUTOFIND_TEST_POSTGRES_IMAGE"], "postgres", "-c", "listen_addresses=",
                "-c", "unix_socket_directories=/var/run/postgresql,/socket"
            ], text=True).strip()
            try:
                for _ in range(150):
                    if (socket / ".s.PGSQL.5432").exists() and subprocess.run([
                        "docker", "exec", container, "sh", "-ec",
                        'test "$(cat /proc/1/comm)" = postgres && pg_isready -q -U postgres'
                    ], capture_output=True).returncode == 0:
                        break
                    time.sleep(0.1)
                else:
                    self.fail("PostgreSQL fixture did not start")
                with closing(psycopg2.connect(host=str(socket), dbname="autoworld", user="postgres")) as db:
                    db.autocommit = True
                    with db.cursor() as cur:
                        self.check_contract(cur)
            finally:
                subprocess.run(["docker", "rm", "-fv", container], check=True, stdout=subprocess.DEVNULL)

    def check_contract(self, cur):
        ddl = historical_ddl()
        cur.execute("BEGIN;" + ddl + "COMMIT;")
        cur.execute(f"INSERT INTO {SCHEMA}.metadata VALUES ('schema','wrong')")
        with self.assertRaisesRegex(psycopg2.Error, "historical_catalog_required"):
            cur.execute(UP)
        cur.execute("ROLLBACK")
        cur.execute(f"UPDATE {SCHEMA}.metadata SET value=%s WHERE key='schema'",
                    ("leboncoin-private-trial/v1:" + hashlib.sha256(ddl.encode()).hexdigest(),))
        cur.execute(UP)
        cur.execute(UP)
        cur.execute(DOWN)
        cur.execute("SELECT to_regclass(%s),to_regclass(%s)", (TABLE, f"{SCHEMA}.latest_listings"))
        self.assertEqual(cur.fetchone(), (None, f"{SCHEMA}.latest_listings"))
        cur.execute(UP)
        cur.execute("CREATE ROLE native_reader; CREATE ROLE native_writer; CREATE ROLE native_expiry;")
        cur.execute(f"GRANT USAGE ON SCHEMA {SCHEMA} TO native_reader,native_writer,native_expiry")
        cur.execute(f"GRANT SELECT ON {VIEW} TO native_reader")
        cur.execute(f"GRANT SELECT,INSERT ON {TABLE} TO native_writer")
        cur.execute(f"GRANT EXECUTE ON FUNCTION {SCHEMA}.purge_rust_exports() TO native_expiry")
        cur.execute(f"""SELECT has_table_privilege('native_reader','{TABLE}','SELECT'),
                       has_table_privilege('native_writer','{TABLE}','UPDATE,DELETE'),
                       has_function_privilege('native_writer','{SCHEMA}.purge_rust_exports()','EXECUTE')""")
        self.assertEqual(cur.fetchone(), (False, False, False))
        origin = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=5)
        day = timedelta(days=1)

        def row(key, gallery, observed=None):
            return dict(source_listing_id=key, brand="Fixture", model=None, year=2020, mileage_km=1,
                        price_amount_minor=None, images=gallery,
                        media_observed_at=observed.isoformat() if observed else None,
                        media_retain_until=(origin + 20 * day).isoformat() if observed else None)

        def add(rows, at, until, number, *, ids=None):
            raw = json.dumps([dict(source_listing_id=i, index=number) for i in
                              (ids if ids is not None else [r["source_listing_id"] for r in rows])],
                             indent=2).encode()
            checksum = hashlib.sha256(raw).hexdigest()
            cur.execute(f"""INSERT INTO {TABLE}(export_sha256,raw_bytes,exported_at,retain_until,row_count,listings)
                           VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                        (checksum, raw, at, until, len(rows), json.dumps(rows)))
            return raw, checksum

        cur.execute("SET ROLE native_writer")
        items = [row("1", [PHOTO], origin), row("2", [], origin), row("3", None), row("4", [PHOTO], origin)]
        raw, checksum = add(items, origin, origin + 10 * day, 1)
        self.assertEqual(cur.rowcount, 1)
        add(items, origin, origin + 10 * day, 1)
        self.assertEqual(cur.rowcount, 0)
        cur.execute(f"SELECT raw_bytes FROM {TABLE} WHERE export_sha256=%s", (checksum,))
        self.assertEqual(bytes(cur.fetchone()[0]), raw)
        with self.assertRaisesRegex(psycopg2.Error, "native_projection_identity_mismatch"):
            add(items, origin, origin + 10 * day, 17, ids=["1","1","3","4"])
        with self.assertRaisesRegex(psycopg2.Error, "invalid_native_projection"):
            add([row("1", [PHOTO])], origin, origin + 10 * day, 18)

        # A newer export omits a known gallery. Preserve its observation time.
        add([row("1", None)], origin + day, origin + 11 * day, 2)
        cur.execute("SET ROLE native_reader")
        cur.execute(f"SELECT source_listing_id,images FROM {VIEW} ORDER BY 1")
        self.assertEqual(cur.fetchall(), [("1",[PHOTO]), ("2",[]), ("3",None), ("4",[PHOTO])])
        cur.execute(f"SELECT exported_at,media_observed_at,price_amount_minor FROM {VIEW} WHERE source_listing_id='1'")
        self.assertEqual(cur.fetchone(), (origin + day, origin, None))

        # Latest evidence for one ID has an earlier file deadline than the older archive.
        cur.execute("SET ROLE native_writer")
        add([row("1", [], origin + 2*day), row("4", None)], origin + 2*day, origin + 3*day, 3)
        add([row("1", None)], origin + 4*day, origin + 12*day, 4)
        cur.execute("SET ROLE native_reader")
        cur.execute(f"SELECT source_listing_id,images FROM {VIEW} ORDER BY 1")
        expected = [("1",None), ("2",[]), ("3",None)]
        self.assertEqual(cur.fetchall(), expected)
        cur.execute("SET ROLE native_expiry")
        for count in (1,0):
            cur.execute(f"SELECT {SCHEMA}.purge_rust_exports()")
            self.assertEqual(cur.fetchone(), (count,))
        cur.execute("SET ROLE native_reader")
        cur.execute(f"SELECT source_listing_id,images FROM {VIEW} ORDER BY 1")
        self.assertEqual(cur.fetchall(), expected)
        cur.execute("RESET ROLE")
        with self.assertRaisesRegex(psycopg2.Error, "immutable_native_export"):
            cur.execute(f"UPDATE {TABLE} SET exported_at=exported_at+interval '1 second'")
        with self.assertRaisesRegex(psycopg2.Error, "native_export_table_not_empty"):
            cur.execute(DOWN)
        cur.execute("ROLLBACK")
        cur.execute(f"SELECT count(*) FROM {SCHEMA}.observations")
        self.assertEqual(cur.fetchone(), (0,))


if __name__ == "__main__":
    unittest.main()
