BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(109624, 137100);
DO $$ BEGIN
    IF current_database() <> 'autoworld'
       OR obj_description('aw_acquisition_trial.rust_exports'::regclass, 'pg_class')
          IS DISTINCT FROM 'aw-leboncoin-native-export/v1'
       OR obj_description('aw_acquisition_trial.catalog_rust_provenance'::regclass, 'pg_class')
          IS DISTINCT FROM 'autofind-catalog-publication/v1'
       OR obj_description('aw_acquisition_trial.catalog_dom_provenance'::regclass, 'pg_class')
          IS DISTINCT FROM 'autofind-catalog-publication/v1'
    THEN RAISE EXCEPTION 'wrong_project_catalogue'; END IF;
END $$;

DO $$
DECLARE object record;
BEGIN
    FOR object IN SELECT * FROM (VALUES
        (to_regprocedure('aw_acquisition_trial.valid_rust_vehicle_evidence(bytea,jsonb)')::oid, 'pg_proc'),
        (to_regprocedure('aw_acquisition_trial.guard_rust_vehicle_evidence()')::oid, 'pg_proc'),
        ((SELECT oid FROM pg_trigger WHERE tgrelid = 'aw_acquisition_trial.rust_exports'::regclass
             AND tgname = 'guard_rust_vehicle_evidence'), 'pg_trigger')
    ) objects(id, catalog) LOOP
        IF object.id IS NOT NULL AND obj_description(object.id, object.catalog::name)
             IS DISTINCT FROM 'autofind-private-rust-features/v1'
        THEN RAISE EXCEPTION 'unexpected_existing_feature_guard'; END IF;
    END LOOP;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_attribute
                   WHERE attrelid = 'aw_acquisition_trial.catalog_rust_provenance'::regclass
                     AND attname = 'vehicle_features' AND atttypid = 'jsonb'::regtype AND NOT attisdropped)
       OR NOT EXISTS (SELECT FROM pg_attribute
                   WHERE attrelid = 'aw_acquisition_trial.catalog_dom_provenance'::regclass
                     AND attname = 'listing_observation_sha256' AND atttypid = 'text'::regtype AND NOT attisdropped)
    THEN RAISE EXCEPTION 'feature_view_not_installed'; END IF;
END $$;

-- PostgreSQL keeps dependent objects, owner and ACLs on CREATE OR REPLACE.
-- This compatibility slot stays NULL when the feature is disabled.
CREATE OR REPLACE VIEW aw_acquisition_trial.catalog_dom_provenance WITH (security_barrier = true) AS
SELECT l.source_id, l.source_listing_id, l.original_url, l.captured_at, l.normalized_json,
    ARRAY(SELECT b.batch_id FROM aw_acquisition_trial.batch_entries b
          WHERE b.observation_sha256 = l.observation_sha256 AND b.source_listing_id = l.source_listing_id) AS batch_ids,
    NULL::text AS listing_observation_sha256
FROM aw_acquisition_trial.latest_listings l;

CREATE OR REPLACE VIEW aw_acquisition_trial.catalog_rust_provenance WITH (security_barrier = true) AS
WITH versions AS (
    SELECT e.export_sha256, e.exported_at, e.retain_until, r.*,
        r.source_listing_id = ANY(e.suppressed_listings) AS suppress_listing,
        r.source_listing_id = ANY(e.suppressed_galleries) AS suppress_gallery
    FROM aw_acquisition_trial.rust_exports e
    CROSS JOIN LATERAL jsonb_to_recordset(e.listings) AS r(
        source_listing_id text, brand text, model text, year integer, price_amount_minor bigint, mileage_km bigint,
        media_observed_at timestamptz, media_retain_until timestamptz, images text[]
    ) WHERE e.exported_at <= CURRENT_TIMESTAMP
), latest AS (
    SELECT DISTINCT ON (source_listing_id) *
    FROM versions WHERE NOT suppress_listing ORDER BY source_listing_id, exported_at DESC, export_sha256
), gallery AS (
    SELECT DISTINCT ON (source_listing_id) source_listing_id, export_sha256, media_observed_at, media_retain_until, images, retain_until
    FROM versions WHERE images IS NOT NULL AND NOT suppress_gallery
    ORDER BY source_listing_id, media_observed_at DESC, (cardinality(images) = 0) DESC, exported_at DESC, export_sha256
)
SELECT l.source_listing_id, l.exported_at, g.media_observed_at, least(g.media_retain_until, g.retain_until) AS media_retain_until,
    l.brand, l.model, l.year, l.price_amount_minor, l.mileage_km,
    CASE WHEN g.media_retain_until > CURRENT_TIMESTAMP AND g.retain_until > CURRENT_TIMESTAMP THEN g.images END AS images,
    l.export_sha256 AS listing_export, g.export_sha256 AS gallery_export, NULL::jsonb AS vehicle_features
FROM latest l LEFT JOIN gallery g USING (source_listing_id)
WHERE l.retain_until > CURRENT_TIMESTAMP;

DROP TRIGGER IF EXISTS guard_rust_vehicle_evidence ON aw_acquisition_trial.rust_exports;
DROP FUNCTION IF EXISTS aw_acquisition_trial.guard_rust_vehicle_evidence();
DROP FUNCTION IF EXISTS aw_acquisition_trial.valid_rust_vehicle_evidence(bytea,jsonb);
COMMIT;
