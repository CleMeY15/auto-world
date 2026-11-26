BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(109624,137100);
LOCK TABLE aw_acquisition_trial.rust_exports IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
    IF current_database() <> 'autoworld' OR
        (SELECT value FROM aw_acquisition_trial.metadata WHERE key = 'schema') IS DISTINCT FROM
        'leboncoin-private-trial/v1:6c83f9f0e4b4f482352aa9d3015782e51029e0483bb3514319a77c90bf07a495' OR
        obj_description('aw_acquisition_trial.rust_exports'::regclass, 'pg_class') IS DISTINCT FROM 'aw-leboncoin-native-export/v1'
    THEN RAISE EXCEPTION 'historical_catalog_required'; END IF;
    IF EXISTS (SELECT FROM aw_acquisition_trial.rust_exports) THEN RAISE EXCEPTION 'native_export_table_not_empty'; END IF;
END $$;
DROP VIEW aw_acquisition_trial.rust_export_listings;
DROP FUNCTION aw_acquisition_trial.purge_rust_exports();
DROP TABLE aw_acquisition_trial.rust_exports;
DROP FUNCTION aw_acquisition_trial.guard_rust_export();
COMMIT;
