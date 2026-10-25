CREATE SCHEMA aw_foundation AUTHORIZATION aw_migrator;
REVOKE ALL ON SCHEMA aw_foundation FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA aw_foundation REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE DOMAIN aw_foundation.source_id AS text COLLATE "C"
  CHECK (VALUE ~ '^src_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
CREATE DOMAIN aw_foundation.run_id AS text COLLATE "C"
  CHECK (VALUE ~ '^run_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
CREATE DOMAIN aw_foundation.raw_id AS text COLLATE "C"
  CHECK (VALUE ~ '^raw_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
CREATE DOMAIN aw_foundation.vehicle_id AS text COLLATE "C"
  CHECK (VALUE ~ '^veh_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
CREATE DOMAIN aw_foundation.listing_id AS text COLLATE "C"
  CHECK (VALUE ~ '^lst_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
CREATE DOMAIN aw_foundation.observation_id AS text COLLATE "C"
  CHECK (VALUE ~ '^obs_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
CREATE DOMAIN aw_foundation.digest AS text COLLATE "C"
  CHECK (VALUE ~ '^[a-f0-9]{64}$');
CREATE DOMAIN aw_foundation.utc_time AS timestamptz(3)
  CHECK (isfinite(VALUE) AND VALUE >= TIMESTAMPTZ '0001-01-01 00:00:00+00'
    AND VALUE < TIMESTAMPTZ '10000-01-01 00:00:00+00');

CREATE TABLE aw_foundation.source_reference (
  source_id aw_foundation.source_id PRIMARY KEY
);
CREATE TABLE aw_foundation.connector_run_reference (
  run_id aw_foundation.run_id PRIMARY KEY,
  source_id aw_foundation.source_id NOT NULL REFERENCES aw_foundation.source_reference ON DELETE RESTRICT,
  UNIQUE (run_id, source_id)
);
CREATE INDEX connector_run_source_idx ON aw_foundation.connector_run_reference (source_id);

CREATE TABLE aw_foundation.raw_snapshot_reference (
  snapshot_id aw_foundation.raw_id PRIMARY KEY,
  run_id aw_foundation.run_id NOT NULL,
  source_id aw_foundation.source_id NOT NULL,
  sha256 aw_foundation.digest NOT NULL,
  bucket text COLLATE "C" NOT NULL CHECK (bucket ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  object_key text COLLATE "C" NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 0 AND 1048576),
  captured_at aw_foundation.utc_time NOT NULL,
  raw_retain_until aw_foundation.utc_time NOT NULL CHECK (raw_retain_until >= captured_at),
  normalized_retain_until aw_foundation.utc_time NOT NULL CHECK (normalized_retain_until >= captured_at),
  media_retain_until aw_foundation.utc_time CHECK (media_retain_until >= captured_at),
  pii_retain_until aw_foundation.utc_time CHECK (pii_retain_until >= captured_at),
  cache_retain_until aw_foundation.utc_time CHECK (cache_retain_until >= captured_at),
  policy_metadata jsonb NOT NULL CHECK (coalesce(
    jsonb_typeof(policy_metadata) = 'object' AND policy_metadata->'schemaVersion' = '1'::jsonb
    AND policy_metadata->>'sourceId' = source_id AND jsonb_typeof(policy_metadata->'revisions') = 'array', false)),
  FOREIGN KEY (run_id, source_id) REFERENCES aw_foundation.connector_run_reference (run_id, source_id) ON DELETE RESTRICT,
  UNIQUE (snapshot_id, run_id, source_id, sha256),
  UNIQUE (bucket, object_key),
  CHECK (object_key = 'v1/raw/' || source_id || '/' || run_id || '/' || snapshot_id)
);
CREATE INDEX raw_run_source_idx ON aw_foundation.raw_snapshot_reference (run_id, source_id);

CREATE TABLE aw_foundation.vehicle_candidate (
  vehicle_id aw_foundation.vehicle_id PRIMARY KEY,
  identity_status text NOT NULL CHECK (identity_status = 'candidate')
);
CREATE TABLE aw_foundation.listing (
  listing_id aw_foundation.listing_id PRIMARY KEY,
  source_id aw_foundation.source_id NOT NULL REFERENCES aw_foundation.source_reference ON DELETE RESTRICT,
  source_listing_id text COLLATE "C" NOT NULL CHECK (char_length(source_listing_id) BETWEEN 1 AND 256),
  candidate_vehicle_id aw_foundation.vehicle_id REFERENCES aw_foundation.vehicle_candidate ON DELETE RESTRICT,
  UNIQUE (source_id, source_listing_id),
  UNIQUE (listing_id, source_id)
);
CREATE INDEX listing_vehicle_idx ON aw_foundation.listing (candidate_vehicle_id);

CREATE TABLE aw_foundation.listing_version (
  version_id text COLLATE "C" PRIMARY KEY CHECK (version_id ~ '^lv_[a-f0-9]{64}$'),
  listing_id aw_foundation.listing_id NOT NULL,
  source_id aw_foundation.source_id NOT NULL,
  run_id aw_foundation.run_id NOT NULL,
  snapshot_id aw_foundation.raw_id NOT NULL,
  sha256 aw_foundation.digest NOT NULL,
  mapper_version text NOT NULL CHECK (char_length(mapper_version) BETWEEN 1 AND 128),
  captured_at aw_foundation.utc_time NOT NULL,
  url text CHECK (char_length(url) <= 2048 AND url LIKE 'https://%'),
  normalized_retain_until aw_foundation.utc_time NOT NULL CHECK (normalized_retain_until >= captured_at),
  media_retain_until aw_foundation.utc_time CHECK (media_retain_until >= captured_at),
  pii_retain_until aw_foundation.utc_time CHECK (pii_retain_until >= captured_at),
  cache_retain_until aw_foundation.utc_time CHECK (cache_retain_until >= captured_at),
  FOREIGN KEY (listing_id, source_id) REFERENCES aw_foundation.listing (listing_id, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (snapshot_id, run_id, source_id, sha256) REFERENCES aw_foundation.raw_snapshot_reference (snapshot_id, run_id, source_id, sha256) ON DELETE RESTRICT,
  UNIQUE (version_id, listing_id)
);
CREATE INDEX version_listing_source_idx ON aw_foundation.listing_version (listing_id, source_id);
CREATE INDEX version_raw_idx ON aw_foundation.listing_version (snapshot_id, run_id, source_id, sha256);

CREATE TABLE aw_foundation.observation (
  observation_id aw_foundation.observation_id PRIMARY KEY,
  subject_kind text NOT NULL CHECK (subject_kind IN ('listing', 'vehicle')),
  listing_id aw_foundation.listing_id,
  vehicle_id aw_foundation.vehicle_id REFERENCES aw_foundation.vehicle_candidate ON DELETE RESTRICT,
  source_id aw_foundation.source_id NOT NULL,
  run_id aw_foundation.run_id NOT NULL,
  snapshot_id aw_foundation.raw_id NOT NULL,
  sha256 aw_foundation.digest NOT NULL,
  field text NOT NULL CHECK (field IN ('price', 'mileage', 'power', 'co2', 'vin')),
  value_json jsonb NOT NULL CHECK (jsonb_typeof(value_json) = 'object'),
  observed_at aw_foundation.utc_time NOT NULL,
  method text NOT NULL CHECK (method IN ('api', 'feed', 'crawl', 'manual')),
  legal_status text NOT NULL CHECK (legal_status IN ('official_api', 'licensed_partner', 'dealer_feed', 'permitted_crawl', 'restricted', 'blocked', 'unknown')),
  confidence_bps integer NOT NULL CHECK (confidence_bps BETWEEN 0 AND 10000),
  CHECK ((subject_kind = 'listing' AND listing_id IS NOT NULL AND vehicle_id IS NULL)
    OR (subject_kind = 'vehicle' AND vehicle_id IS NOT NULL AND listing_id IS NULL)),
  FOREIGN KEY (listing_id, source_id) REFERENCES aw_foundation.listing (listing_id, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (snapshot_id, run_id, source_id, sha256) REFERENCES aw_foundation.raw_snapshot_reference (snapshot_id, run_id, source_id, sha256) ON DELETE RESTRICT,
  UNIQUE (observation_id, listing_id)
);
CREATE INDEX observation_vehicle_idx ON aw_foundation.observation (vehicle_id);
CREATE INDEX observation_listing_source_idx ON aw_foundation.observation (listing_id, source_id);
CREATE INDEX observation_raw_idx ON aw_foundation.observation (snapshot_id, run_id, source_id, sha256);

CREATE TABLE aw_foundation.listing_version_observation (
  version_id text COLLATE "C" NOT NULL,
  listing_id aw_foundation.listing_id NOT NULL,
  observation_id aw_foundation.observation_id NOT NULL,
  PRIMARY KEY (version_id, observation_id),
  FOREIGN KEY (version_id, listing_id) REFERENCES aw_foundation.listing_version (version_id, listing_id) ON DELETE RESTRICT,
  FOREIGN KEY (observation_id, listing_id) REFERENCES aw_foundation.observation (observation_id, listing_id) ON DELETE RESTRICT
);
CREATE INDEX version_observation_version_idx ON aw_foundation.listing_version_observation (version_id, listing_id);
CREATE INDEX version_observation_observation_idx ON aw_foundation.listing_version_observation (observation_id, listing_id);

CREATE TABLE aw_foundation.outbox_event (
  operation_key text COLLATE "C" PRIMARY KEY CHECK (operation_key ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  event_name text NOT NULL CHECK (event_name IN ('source.listing.seen', 'listing.created', 'listing.updated', 'listing.withdrawn', 'vehicle.merged', 'vehicle.split', 'price.changed', 'saved_search.matched', 'notification.requested', 'notification.delivered')),
  source_id aw_foundation.source_id NOT NULL,
  run_id aw_foundation.run_id NOT NULL,
  listing_id aw_foundation.listing_id,
  recorded_at aw_foundation.utc_time NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  FOREIGN KEY (run_id, source_id) REFERENCES aw_foundation.connector_run_reference (run_id, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (listing_id, source_id) REFERENCES aw_foundation.listing (listing_id, source_id) ON DELETE RESTRICT
);
CREATE INDEX outbox_run_source_idx ON aw_foundation.outbox_event (run_id, source_id);
CREATE INDEX outbox_listing_source_idx ON aw_foundation.outbox_event (listing_id, source_id);
CREATE TABLE aw_foundation.outbox_delivery (
  operation_key text COLLATE "C" PRIMARY KEY REFERENCES aw_foundation.outbox_event ON DELETE RESTRICT,
  available_at aw_foundation.utc_time NOT NULL,
  delivered_at aw_foundation.utc_time CHECK (delivered_at >= available_at),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000000)
);
CREATE INDEX outbox_pending_idx ON aw_foundation.outbox_delivery (available_at, operation_key) WHERE delivered_at IS NULL;

CREATE FUNCTION aw_foundation.reject_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $immutable$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'immutable_evidence';
END
$immutable$;
REVOKE ALL ON FUNCTION aw_foundation.reject_evidence_mutation() FROM PUBLIC;

DO $triggers$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['source_reference', 'connector_run_reference', 'raw_snapshot_reference', 'vehicle_candidate', 'listing', 'listing_version', 'observation', 'listing_version_observation', 'outbox_event'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON aw_foundation.%I FOR EACH ROW EXECUTE FUNCTION aw_foundation.reject_evidence_mutation()', relation_name);
    EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON aw_foundation.%I FOR EACH STATEMENT EXECUTE FUNCTION aw_foundation.reject_evidence_mutation()', relation_name);
  END LOOP;
END
$triggers$;
GRANT USAGE ON SCHEMA aw_foundation TO aw_writer, aw_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA aw_foundation TO aw_reader;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA aw_foundation TO aw_writer;
GRANT UPDATE (available_at, delivered_at, attempts) ON aw_foundation.outbox_delivery TO aw_writer;
