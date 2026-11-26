BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(109624, 137100);

DO $$
DECLARE
    object record;
    marker constant text := 'aw-leboncoin-native-export/v1';
BEGIN
    IF current_database() <> 'autoworld' OR
        (SELECT value FROM aw_acquisition_trial.metadata WHERE key = 'schema') IS DISTINCT FROM
        'leboncoin-private-trial/v1:6c83f9f0e4b4f482352aa9d3015782e51029e0483bb3514319a77c90bf07a495'
    THEN RAISE EXCEPTION 'historical_catalog_required'; END IF;
    FOR object IN SELECT * FROM (VALUES
        (to_regclass('aw_acquisition_trial.rust_exports')::oid, 'pg_class'),
        (to_regclass('aw_acquisition_trial.rust_export_listings')::oid, 'pg_class'),
        (to_regprocedure('aw_acquisition_trial.guard_rust_export()')::oid, 'pg_proc'),
        (to_regprocedure('aw_acquisition_trial.purge_rust_exports()')::oid, 'pg_proc')
    ) objects(id, catalog) LOOP
        IF object.id IS NOT NULL AND obj_description(object.id, object.catalog::name) IS DISTINCT FROM marker
        THEN RAISE EXCEPTION 'unexpected_existing_object'; END IF;
    END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS aw_acquisition_trial.rust_exports (
    export_sha256 text PRIMARY KEY CHECK (export_sha256 = encode(sha256(raw_bytes), 'hex')),
    raw_bytes bytea NOT NULL CHECK (octet_length(raw_bytes) > 0),
    exported_at timestamptz NOT NULL CHECK (isfinite(exported_at)),
    retain_until timestamptz NOT NULL CHECK (isfinite(retain_until) AND retain_until > exported_at),
    row_count integer NOT NULL CHECK (row_count >= 0),
    listings jsonb NOT NULL CHECK (jsonb_typeof(listings) = 'array' AND jsonb_array_length(listings) = row_count),
    suppressed_listings text[] NOT NULL DEFAULT '{}',
    suppressed_galleries text[] NOT NULL DEFAULT '{}'
);
COMMENT ON TABLE aw_acquisition_trial.rust_exports IS 'aw-leboncoin-native-export/v1';
REVOKE ALL ON aw_acquisition_trial.rust_exports FROM PUBLIC;

CREATE OR REPLACE FUNCTION aw_acquisition_trial.guard_rust_export() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
    native jsonb;
    distinct_ids integer;
    invalid boolean;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.export_sha256, NEW.raw_bytes, NEW.exported_at, NEW.retain_until, NEW.row_count, NEW.listings)
               IS DISTINCT FROM
           (OLD.export_sha256, OLD.raw_bytes, OLD.exported_at, OLD.retain_until, OLD.row_count, OLD.listings)
           OR NOT (NEW.suppressed_listings @> OLD.suppressed_listings AND NEW.suppressed_galleries @> OLD.suppressed_galleries)
        THEN RAISE EXCEPTION 'immutable_native_export'; END IF;
        RETURN NEW;
    END IF;
    IF cardinality(NEW.suppressed_listings) + cardinality(NEW.suppressed_galleries) <> 0
    THEN RAISE EXCEPTION 'invalid_initial_suppression'; END IF;
    native := convert_from(NEW.raw_bytes, 'UTF8')::jsonb;
    IF jsonb_typeof(native) IS DISTINCT FROM 'array' OR jsonb_array_length(native) <> NEW.row_count
    THEN RAISE EXCEPTION 'native_row_count_mismatch'; END IF;
    IF EXISTS (
        (SELECT item->>'source_listing_id' FROM jsonb_array_elements(native) item
         EXCEPT SELECT item->>'source_listing_id' FROM jsonb_array_elements(NEW.listings) item)
        UNION ALL
        (SELECT item->>'source_listing_id' FROM jsonb_array_elements(NEW.listings) item
         EXCEPT SELECT item->>'source_listing_id' FROM jsonb_array_elements(native) item)
    ) THEN RAISE EXCEPTION 'native_projection_identity_mismatch'; END IF;

    SELECT count(DISTINCT r.source_listing_id), bool_or(
        r.source_listing_id IS NULL OR r.source_listing_id !~ '^[1-9][0-9]{0,19}$'
        OR r.year < 0 OR r.price_amount_minor < 0 OR r.mileage_km < 0
        OR (r.images IS NULL AND (r.media_observed_at IS NOT NULL OR r.media_retain_until IS NOT NULL))
        OR (r.images IS NOT NULL AND (
            r.media_observed_at IS NULL OR NOT isfinite(r.media_observed_at) OR r.media_observed_at > NEW.exported_at
            OR r.media_retain_until IS NULL OR NOT isfinite(r.media_retain_until)
            OR r.media_retain_until <= r.media_observed_at OR NEW.retain_until > r.media_retain_until
            OR array_ndims(r.images) > 1 OR EXISTS (SELECT FROM unnest(r.images) image
                WHERE image IS NULL OR image !~ '^https://img[.]leboncoin[.]fr/api/v1/lbcpb1/images/[^#[:space:]]+$')
        ))
    ) INTO distinct_ids, invalid FROM jsonb_to_recordset(NEW.listings) AS r(
        source_listing_id text, brand text, model text, year integer, price_amount_minor bigint, mileage_km bigint,
        media_observed_at timestamptz, media_retain_until timestamptz, images text[]
    );
    IF distinct_ids <> NEW.row_count OR invalid THEN RAISE EXCEPTION 'invalid_native_projection'; END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION aw_acquisition_trial.guard_rust_export() IS 'aw-leboncoin-native-export/v1';
REVOKE ALL ON FUNCTION aw_acquisition_trial.guard_rust_export() FROM PUBLIC;
CREATE OR REPLACE TRIGGER guard_rust_export BEFORE INSERT OR UPDATE ON aw_acquisition_trial.rust_exports
FOR EACH ROW EXECUTE FUNCTION aw_acquisition_trial.guard_rust_export();

CREATE OR REPLACE VIEW aw_acquisition_trial.rust_export_listings WITH (security_barrier = true) AS
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
    SELECT DISTINCT ON (source_listing_id) source_listing_id, media_observed_at, media_retain_until, images, retain_until
    FROM versions WHERE images IS NOT NULL AND NOT suppress_gallery
    ORDER BY source_listing_id, media_observed_at DESC, (cardinality(images) = 0) DESC, exported_at DESC, export_sha256
)
SELECT l.source_listing_id, l.exported_at, g.media_observed_at, least(g.media_retain_until, g.retain_until) AS media_retain_until,
    l.brand, l.model, l.year, l.price_amount_minor, l.mileage_km,
    CASE WHEN g.media_retain_until > CURRENT_TIMESTAMP AND g.retain_until > CURRENT_TIMESTAMP THEN g.images END AS images
FROM latest l LEFT JOIN gallery g USING (source_listing_id)
WHERE l.retain_until > CURRENT_TIMESTAMP;
COMMENT ON VIEW aw_acquisition_trial.rust_export_listings IS 'aw-leboncoin-native-export/v1';
REVOKE ALL ON aw_acquisition_trial.rust_export_listings FROM PUBLIC;

CREATE OR REPLACE FUNCTION aw_acquisition_trial.purge_rust_exports() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    removed bigint;
    cutoff timestamptz := statement_timestamp();
BEGIN
    -- Serialize retention with new INSERTs. Before deleting an expired archive, record
    -- which projections in the remaining archives have already been superseded.
    LOCK TABLE aw_acquisition_trial.rust_exports IN SHARE ROW EXCLUSIVE MODE;
    IF NOT EXISTS (SELECT FROM aw_acquisition_trial.rust_exports WHERE retain_until <= cutoff)
    THEN RETURN 0; END IF;
    WITH versions AS (
        SELECT e.export_sha256, e.exported_at, e.retain_until <= cutoff AS expired, r.*
        FROM aw_acquisition_trial.rust_exports e CROSS JOIN LATERAL jsonb_to_recordset(e.listings)
            AS r(source_listing_id text, media_observed_at timestamptz, images text[])
    ), ranked AS (
        SELECT *,
            bool_or(expired) OVER (PARTITION BY source_listing_id ORDER BY exported_at DESC, export_sha256) AS older_listing,
            bool_or(expired AND images IS NOT NULL) OVER (PARTITION BY source_listing_id ORDER BY media_observed_at DESC NULLS LAST,
                (cardinality(images) = 0) DESC, exported_at DESC, export_sha256) AS older_gallery
        FROM versions
    ), masks AS (
        SELECT export_sha256,
            array_agg(source_listing_id) FILTER (WHERE older_listing) AS listings,
            array_agg(source_listing_id) FILTER (WHERE older_gallery AND images IS NOT NULL) AS galleries
        FROM ranked WHERE NOT expired AND (older_listing OR (older_gallery AND images IS NOT NULL))
        GROUP BY export_sha256
    )
    UPDATE aw_acquisition_trial.rust_exports e
    SET suppressed_listings = ARRAY(SELECT DISTINCT id FROM unnest(e.suppressed_listings || m.listings) id),
        suppressed_galleries = ARRAY(SELECT DISTINCT id FROM unnest(e.suppressed_galleries || m.galleries) id)
    FROM masks m WHERE e.export_sha256 = m.export_sha256;
    DELETE FROM aw_acquisition_trial.rust_exports WHERE retain_until <= cutoff;
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END $$;
COMMENT ON FUNCTION aw_acquisition_trial.purge_rust_exports() IS 'aw-leboncoin-native-export/v1';
REVOKE ALL ON FUNCTION aw_acquisition_trial.purge_rust_exports() FROM PUBLIC;
COMMIT;
