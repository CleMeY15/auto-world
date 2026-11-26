BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(109624, 137100);
DO $$ BEGIN
    IF current_database() <> 'autoworld' OR
       obj_description('aw_acquisition_trial.rust_export_listings'::regclass, 'pg_class')
         IS DISTINCT FROM 'aw-leboncoin-native-export/v1' OR
       obj_description('aw_acquisition_trial.catalog_media_history'::regclass, 'pg_class')
         IS DISTINCT FROM 'autofind-private-dom-media-history/v1'
    THEN RAISE EXCEPTION 'wrong_project_catalogue'; END IF;
END $$;
DO $$ BEGIN
    IF obj_description('aw_acquisition_trial.catalog_dom_provenance'::regclass, 'pg_class')
        IS DISTINCT FROM 'autofind-catalog-publication/v1' OR
       obj_description('aw_acquisition_trial.catalog_rust_provenance'::regclass, 'pg_class')
        IS DISTINCT FROM 'autofind-catalog-publication/v1'
    THEN RAISE EXCEPTION 'unexpected_publication_views'; END IF;
END $$;
DROP VIEW aw_acquisition_trial.catalog_dom_provenance, aw_acquisition_trial.catalog_rust_provenance;
COMMIT;
