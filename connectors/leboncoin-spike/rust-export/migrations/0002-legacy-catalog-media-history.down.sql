BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(109624, 137100);
DO $$ BEGIN
    IF current_database() <> 'autoworld' OR
        obj_description(to_regclass('aw_acquisition_trial.catalog_media_history'), 'pg_class')
            IS DISTINCT FROM 'autofind-private-dom-media-history/v1'
    THEN RAISE EXCEPTION 'wrong_database_or_historical_view'; END IF;
END $$;
DROP VIEW aw_acquisition_trial.catalog_media_history;
COMMIT;
