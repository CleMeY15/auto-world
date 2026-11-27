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

-- Validate the raw/normalized pair at write time. The reader view only visits the projection.
CREATE OR REPLACE FUNCTION aw_acquisition_trial.valid_rust_vehicle_evidence(raw_bytes bytea, listings jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
    WITH native AS (
        SELECT item FROM jsonb_array_elements(convert_from(raw_bytes, 'UTF8')::jsonb) item
    ), proofs AS (
        SELECT item->>'source_listing_id' AS listing_id, item->'source_listing_id' AS native_id,
               item->'vehicle_features_evidence' AS proof
        FROM native WHERE item ? 'vehicle_features_evidence'
    ), normalized AS (
        SELECT item FROM jsonb_array_elements(listings) item
    ), projections AS (
        SELECT item->>'source_listing_id' AS listing_id, item->'source_listing_id' AS normalized_id,
               item->'vehicle_features' AS features
        FROM normalized WHERE item ? 'vehicle_features'
    )
    SELECT (SELECT coalesce(
        bool_and(NOT (item ? 'vehicle_labels_version') AND NOT (item ? 'vehicle_features')) OR
        bool_and(coalesce((item->'vehicle_labels_version')::text = '2', false)), true) FROM normalized)
    AND NOT EXISTS (
        SELECT FROM native r
        LEFT JOIN normalized n ON n.item->>'source_listing_id' = r.item->>'source_listing_id'
        WHERE r.item ? 'vehicle_model_evidence' AND (
            jsonb_typeof(r.item->'source_listing_id') IS DISTINCT FROM 'string'
            OR r.item->'source_listing_id' IS DISTINCT FROM n.item->'source_listing_id'
            OR (n.item->'vehicle_labels_version')::text IS DISTINCT FROM '2'
            OR jsonb_typeof(r.item->'marque') IS DISTINCT FROM 'string'
            OR jsonb_typeof(r.item->'modele') IS DISTINCT FROM 'string'
            OR btrim(r.item->>'marque') = '' OR btrim(r.item->>'modele') = ''
            OR n.item->'brand' IS DISTINCT FROM r.item->'marque'
            OR n.item->'model' IS DISTINCT FROM r.item->'modele'
            OR r.item->'vehicle_model_evidence' IS DISTINCT FROM jsonb_build_object(
                'schema', 'searchData.ads.offer.model/v1', 'list_id', r.item->'source_listing_id',
                'brand', r.item->'marque', 'model', r.item->'modele')
        )
    )
    AND NOT EXISTS (
        SELECT FROM proofs p FULL JOIN projections n USING (listing_id)
        WHERE p.listing_id IS NULL OR n.listing_id IS NULL
           OR jsonb_typeof(native_id) <> 'string' OR jsonb_typeof(normalized_id) <> 'string'
           OR jsonb_typeof(features) <> 'object'
           OR features = '{}'::jsonb
           OR proof IS DISTINCT FROM jsonb_build_object('schema', 'searchData.ads.offer.features/v1',
                                                        'list_id', n.listing_id, 'attributes', features)
           OR (proof->'attributes')::text IS DISTINCT FROM features::text
           OR EXISTS (
               SELECT FROM jsonb_each(CASE WHEN jsonb_typeof(features) = 'object' THEN features ELSE '{}'::jsonb END) f
               WHERE NOT CASE f.key
                   WHEN 'fuel' THEN jsonb_typeof(f.value) = 'string' AND f.value <@ '["Essence","Diesel","Électrique","Hybride","Hybride rechargeable","GPL","Bioéthanol","GNV","Hydrogène","Autre"]'::jsonb
                   WHEN 'gearbox' THEN jsonb_typeof(f.value) = 'string' AND f.value <@ '["Manuelle","Automatique","Semi-automatique"]'::jsonb
                   WHEN 'body' THEN jsonb_typeof(f.value) = 'string' AND f.value <@ '["Berline","Citadine","Break","SUV, 4x4 et pick-up","Coupé","Cabriolet","Monospace","Minibus","Utilitaire","Autre"]'::jsonb
                   WHEN 'color' THEN jsonb_typeof(f.value) = 'string' AND f.value <@ '["Argent","Beige","Blanc","Bleu","Bordeaux","Gris","Jaune","Marron","Noir","Orange","Rose","Rouge","Vert","Violet","Autre"]'::jsonb
                   WHEN 'upholstery' THEN jsonb_typeof(f.value) = 'string' AND f.value <@ '["Tissu","Tout cuir","Cuir partiel","Alcantara","Velours","Similicuir","Autre"]'::jsonb
                   WHEN 'doors' THEN jsonb_typeof(f.value) = 'number' AND f.value::text ~ '^[1-9]$'
                   WHEN 'seats' THEN jsonb_typeof(f.value) = 'number' AND f.value::text ~ '^[1-9]$'
                   WHEN 'firstOwner' THEN jsonb_typeof(f.value) = 'boolean'
                   WHEN 'inspectionValid' THEN jsonb_typeof(f.value) = 'boolean'
                   WHEN 'serviceBook' THEN jsonb_typeof(f.value) = 'boolean'
                   ELSE false END
           )
    )
$$;
COMMENT ON FUNCTION aw_acquisition_trial.valid_rust_vehicle_evidence(bytea,jsonb) IS 'autofind-private-rust-features/v1';
REVOKE ALL ON FUNCTION aw_acquisition_trial.valid_rust_vehicle_evidence(bytea,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION aw_acquisition_trial.guard_rust_vehicle_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF NOT aw_acquisition_trial.valid_rust_vehicle_evidence(NEW.raw_bytes, NEW.listings)
    THEN RAISE EXCEPTION 'invalid_native_vehicle_features'; END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION aw_acquisition_trial.guard_rust_vehicle_evidence() IS 'autofind-private-rust-features/v1';
REVOKE ALL ON FUNCTION aw_acquisition_trial.guard_rust_vehicle_evidence() FROM PUBLIC;
CREATE OR REPLACE TRIGGER guard_rust_vehicle_evidence BEFORE INSERT ON aw_acquisition_trial.rust_exports
FOR EACH ROW EXECUTE FUNCTION aw_acquisition_trial.guard_rust_vehicle_evidence();
COMMENT ON TRIGGER guard_rust_vehicle_evidence ON aw_acquisition_trial.rust_exports
    IS 'autofind-private-rust-features/v1';

-- Installing the trigger locked out concurrent inserts. Check earlier exports before
-- exposing them, including a proof whose projection omitted the version during a downgrade.
DO $$ BEGIN
    IF EXISTS (
        SELECT FROM aw_acquisition_trial.rust_exports e
        WHERE NOT aw_acquisition_trial.valid_rust_vehicle_evidence(e.raw_bytes, e.listings)
    ) THEN RAISE EXCEPTION 'invalid_existing_vehicle_features'; END IF;
END $$;

CREATE OR REPLACE VIEW aw_acquisition_trial.catalog_dom_provenance WITH (security_barrier = true) AS
SELECT l.source_id, l.source_listing_id, l.original_url, l.captured_at, l.normalized_json,
    ARRAY(SELECT b.batch_id FROM aw_acquisition_trial.batch_entries b
          WHERE b.observation_sha256 = l.observation_sha256 AND b.source_listing_id = l.source_listing_id) AS batch_ids,
    l.observation_sha256 AS listing_observation_sha256
FROM aw_acquisition_trial.latest_listings l;

CREATE OR REPLACE VIEW aw_acquisition_trial.catalog_rust_provenance WITH (security_barrier = true) AS
WITH versions AS (
    SELECT e.export_sha256, e.exported_at, e.retain_until, r.*,
        r.source_listing_id = ANY(e.suppressed_listings) AS suppress_listing,
        r.source_listing_id = ANY(e.suppressed_galleries) AS suppress_gallery
    FROM aw_acquisition_trial.rust_exports e
    CROSS JOIN LATERAL jsonb_to_recordset(e.listings) AS r(
        source_listing_id text, brand text, model text, year integer, price_amount_minor bigint, mileage_km bigint,
        media_observed_at timestamptz, media_retain_until timestamptz, images text[], vehicle_features jsonb
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
    l.export_sha256 AS listing_export, g.export_sha256 AS gallery_export, l.vehicle_features
FROM latest l LEFT JOIN gallery g USING (source_listing_id)
WHERE l.retain_until > CURRENT_TIMESTAMP;
COMMIT;
