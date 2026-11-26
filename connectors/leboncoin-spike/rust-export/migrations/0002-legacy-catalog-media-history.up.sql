BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(109624, 137100);
DO $$ BEGIN
    IF current_database() <> 'autoworld' OR
        (SELECT value FROM aw_acquisition_trial.metadata WHERE key = 'schema') IS DISTINCT FROM
        'leboncoin-private-trial/v1:6c83f9f0e4b4f482352aa9d3015782e51029e0483bb3514319a77c90bf07a495'
    THEN RAISE EXCEPTION 'wrong_database_or_historical_schema'; END IF;
END $$;

-- An authoritative DOM observation supersedes earlier galleries. Expose its
-- identity and time only, even when a newer observation omitted the gallery.
CREATE VIEW aw_acquisition_trial.catalog_media_history WITH (security_barrier = true) AS
WITH events AS (
    SELECT r.source_id, r.source_listing_id, r.captured_at,
        o.normalized_json->>'status' IS DISTINCT FROM 'listing'
        OR o.normalized_json#>>'{photos,status}' IS DISTINCT FROM 'observed'
        OR jsonb_typeof(o.normalized_json#>'{photos,values}') IS DISTINCT FROM 'array'
        OR o.normalized_json#>'{photos,values}' = '[]'::jsonb AS withdrawn
    FROM aw_acquisition_trial.raw_observations r
    JOIN aw_acquisition_trial.observations o USING (observation_sha256)
    WHERE r.source_id = 'leboncoin' AND r.captured_at <= CURRENT_TIMESTAMP
      AND r.source_listing_id ~ '^[1-9][0-9]{0,19}$'
      AND r.original_url = 'https://www.leboncoin.fr/ad/voitures/' || r.source_listing_id
      AND o.normalized_json#>>'{source,original_url}' = r.original_url
      AND o.normalized_json#>>'{source,listing_id}' = r.source_listing_id
      AND o.normalized_json#>>'{source,name}' = r.source_id
      AND o.normalized_json->>'schema_version' = 'leboncoin-replay/v1'
      AND (o.normalized_json->>'status' IS DISTINCT FROM 'listing'
           OR o.normalized_json#>>'{photos,status}' IN ('observed', 'invalid', 'ambiguous'))
)
SELECT DISTINCT ON (source_id, source_listing_id)
    source_id, source_listing_id, captured_at AS media_event_at, withdrawn
FROM events
-- An explicit withdrawal wins if two observations at the same instant conflict.
ORDER BY source_id, source_listing_id, captured_at DESC, withdrawn DESC;
COMMENT ON VIEW aw_acquisition_trial.catalog_media_history IS 'autofind-private-dom-media-history/v1';
REVOKE ALL ON aw_acquisition_trial.catalog_media_history FROM PUBLIC;
COMMIT;
