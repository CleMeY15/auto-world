CREATE SCHEMA aw_connector AUTHORIZATION aw_migrator;
REVOKE ALL ON SCHEMA aw_connector FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA aw_connector REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE DOMAIN aw_connector.source_id AS text COLLATE "C"
  CHECK (VALUE ~ '^src_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
CREATE DOMAIN aw_connector.run_id AS text COLLATE "C"
  CHECK (VALUE ~ '^run_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
CREATE DOMAIN aw_connector.snapshot_id AS text COLLATE "C"
  CHECK (VALUE ~ '^raw_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$');
CREATE DOMAIN aw_connector.digest AS text COLLATE "C"
  CHECK (VALUE ~ '^[a-f0-9]{64}$');
CREATE DOMAIN aw_connector.operation_key AS text COLLATE "C"
  CHECK (char_length(VALUE) BETWEEN 1 AND 128 AND VALUE ~ '^[A-Za-z0-9][A-Za-z0-9_-]*$');
CREATE DOMAIN aw_connector.safe_integer AS bigint
  CHECK (VALUE BETWEEN 0 AND 9007199254740991);
CREATE DOMAIN aw_connector.utc_time AS timestamptz(3)
  CHECK (isfinite(VALUE) AND VALUE >= TIMESTAMPTZ '0001-01-01 00:00:00+00'
    AND VALUE < TIMESTAMPTZ '10000-01-01 00:00:00+00');

CREATE TABLE aw_connector.sources (
  source_id aw_connector.source_id PRIMARY KEY,
  lease_id text COLLATE "C" UNIQUE CHECK (lease_id IS NULL OR char_length(lease_id) BETWEEN 1 AND 128),
  lease_fence aw_connector.safe_integer NOT NULL DEFAULT 0,
  lease_run_id text COLLATE "C" CHECK (lease_run_id IS NULL OR lease_run_id ~ '^run_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  expires_at aw_connector.utc_time,
  ttl_ms integer CHECK (ttl_ms IS NULL OR ttl_ms BETWEEN 1 AND 605000),
  installed_fence aw_connector.safe_integer NOT NULL DEFAULT 0,
  runtime jsonb NOT NULL CHECK (jsonb_typeof(runtime) = 'object'),
  CHECK ((lease_id IS NULL AND lease_run_id IS NULL AND expires_at IS NULL AND ttl_ms IS NULL)
    OR (lease_id IS NOT NULL AND lease_run_id IS NOT NULL AND expires_at IS NOT NULL AND ttl_ms IS NOT NULL)),
  CHECK (installed_fence <= lease_fence)
);

CREATE TABLE aw_connector.runs (
  source_id aw_connector.source_id NOT NULL REFERENCES aw_connector.sources ON DELETE RESTRICT,
  run_id aw_connector.run_id NOT NULL,
  scope_id text COLLATE "C" NOT NULL CHECK (scope_id ~ '^scope_[a-f0-9]{64}$'),
  lease_fence aw_connector.safe_integer NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed')),
  request_sha256 aw_connector.digest NOT NULL,
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object'),
  policy jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  checkpoint_revision aw_connector.safe_integer NOT NULL,
  checkpoint jsonb NOT NULL CHECK (jsonb_typeof(checkpoint) = 'object'),
  started_at aw_connector.utc_time NOT NULL,
  completed_at aw_connector.utc_time CHECK (completed_at IS NULL OR completed_at >= started_at),
  PRIMARY KEY (source_id, run_id),
  UNIQUE (source_id, run_id, scope_id),
  CHECK ((status = 'running' AND completed_at IS NULL) OR status <> 'running')
);
CREATE INDEX runs_source_status_idx ON aw_connector.runs (source_id, status, started_at);

CREATE TABLE aw_connector.inventories (
  source_id aw_connector.source_id NOT NULL,
  scope_id text COLLATE "C" NOT NULL CHECK (scope_id ~ '^scope_[a-f0-9]{64}$'),
  generation_id text COLLATE "C" NOT NULL CHECK (generation_id = 'empty' OR generation_id ~ '^inv_[a-f0-9]{64}$'),
  revision aw_connector.safe_integer NOT NULL,
  head jsonb NOT NULL CHECK (jsonb_typeof(head) = 'object'),
  PRIMARY KEY (source_id, scope_id),
  FOREIGN KEY (source_id) REFERENCES aw_connector.sources ON DELETE RESTRICT
);

CREATE TABLE aw_connector.raw_pages (
  source_id aw_connector.source_id NOT NULL,
  run_id aw_connector.run_id NOT NULL,
  snapshot_id aw_connector.snapshot_id NOT NULL,
  operation_key aw_connector.operation_key NOT NULL,
  page_ordinal integer NOT NULL CHECK (page_ordinal BETWEEN 0 AND 99999),
  page_identity text COLLATE "C" NOT NULL CHECK (char_length(page_identity) BETWEEN 1 AND 512),
  raw_bytes bytea NOT NULL,
  sha256 aw_connector.digest NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 0 AND 1048576),
  captured_at aw_connector.utc_time NOT NULL,
  raw_retain_until aw_connector.utc_time NOT NULL CHECK (raw_retain_until >= captured_at),
  pending jsonb NOT NULL CHECK (jsonb_typeof(pending) = 'object'),
  obligations jsonb NOT NULL CHECK (jsonb_typeof(obligations) = 'object'),
  PRIMARY KEY (source_id, run_id, snapshot_id),
  UNIQUE (source_id, run_id, operation_key),
  UNIQUE (source_id, run_id, snapshot_id, sha256),
  FOREIGN KEY (source_id, run_id) REFERENCES aw_connector.runs ON DELETE RESTRICT,
  CHECK (octet_length(raw_bytes) = byte_length),
  CHECK (encode(sha256(raw_bytes), 'hex') = sha256)
);
CREATE INDEX raw_pages_retention_idx ON aw_connector.raw_pages (raw_retain_until, source_id, run_id);

CREATE TABLE aw_connector.listing_versions (
  source_id aw_connector.source_id NOT NULL,
  run_id aw_connector.run_id NOT NULL,
  listing_version_id text COLLATE "C" NOT NULL CHECK (listing_version_id ~ '^lv_[a-f0-9]{64}$'),
  listing_id text COLLATE "C" NOT NULL CHECK (listing_id ~ '^lst_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  source_listing_id text COLLATE "C" NOT NULL CHECK (char_length(source_listing_id) BETWEEN 1 AND 256),
  snapshot_id aw_connector.snapshot_id NOT NULL,
  raw_sha256 aw_connector.digest NOT NULL,
  listing jsonb NOT NULL CHECK (jsonb_typeof(listing) = 'object'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  PRIMARY KEY (source_id, run_id, listing_version_id),
  UNIQUE (source_id, listing_version_id),
  UNIQUE (source_id, listing_version_id, listing_id),
  UNIQUE (source_id, run_id, listing_version_id, listing_id, snapshot_id, raw_sha256),
  FOREIGN KEY (source_id, run_id, snapshot_id, raw_sha256)
    REFERENCES aw_connector.raw_pages (source_id, run_id, snapshot_id, sha256) ON DELETE RESTRICT
);
CREATE INDEX listing_versions_listing_idx ON aw_connector.listing_versions (source_id, listing_id);

CREATE TABLE aw_connector.observations (
  source_id aw_connector.source_id NOT NULL,
  run_id aw_connector.run_id NOT NULL,
  observation_id text COLLATE "C" NOT NULL CHECK (observation_id ~ '^obs_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  listing_id text COLLATE "C" NOT NULL CHECK (listing_id ~ '^lst_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  listing_version_id text COLLATE "C" NOT NULL,
  snapshot_id aw_connector.snapshot_id NOT NULL,
  raw_sha256 aw_connector.digest NOT NULL,
  observation jsonb NOT NULL CHECK (jsonb_typeof(observation) = 'object'),
  PRIMARY KEY (source_id, run_id, observation_id),
  FOREIGN KEY (source_id, run_id, listing_version_id, listing_id, snapshot_id, raw_sha256)
    REFERENCES aw_connector.listing_versions (source_id, run_id, listing_version_id, listing_id, snapshot_id, raw_sha256) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, run_id, snapshot_id, raw_sha256)
    REFERENCES aw_connector.raw_pages (source_id, run_id, snapshot_id, sha256) ON DELETE RESTRICT
);

CREATE TABLE aw_connector.tombstones (
  source_id aw_connector.source_id NOT NULL,
  run_id aw_connector.run_id NOT NULL,
  tombstone_id text COLLATE "C" NOT NULL CHECK (tombstone_id ~ '^tmb_[a-f0-9]{64}$'),
  scope_id text COLLATE "C" NOT NULL CHECK (scope_id ~ '^scope_[a-f0-9]{64}$'),
  listing_id text COLLATE "C" NOT NULL CHECK (listing_id ~ '^lst_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  source_listing_id text COLLATE "C" NOT NULL CHECK (char_length(source_listing_id) BETWEEN 1 AND 256),
  kind text NOT NULL CHECK (kind IN ('explicit', 'inferred_missing')),
  snapshot_id aw_connector.snapshot_id,
  raw_sha256 aw_connector.digest,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  PRIMARY KEY (source_id, run_id, tombstone_id),
  FOREIGN KEY (source_id, run_id, scope_id) REFERENCES aw_connector.runs (source_id, run_id, scope_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, run_id, snapshot_id, raw_sha256)
    REFERENCES aw_connector.raw_pages (source_id, run_id, snapshot_id, sha256) ON DELETE RESTRICT,
  CHECK ((kind = 'explicit' AND snapshot_id IS NOT NULL AND raw_sha256 IS NOT NULL)
    OR (kind = 'inferred_missing' AND snapshot_id IS NULL AND raw_sha256 IS NULL))
);
CREATE INDEX tombstones_scope_listing_idx ON aw_connector.tombstones (source_id, scope_id, listing_id);

CREATE TABLE aw_connector.projections (
  source_id aw_connector.source_id NOT NULL,
  scope_id text COLLATE "C" NOT NULL,
  listing_id text COLLATE "C" NOT NULL CHECK (listing_id ~ '^lst_[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  source_listing_id text COLLATE "C" NOT NULL CHECK (char_length(source_listing_id) BETWEEN 1 AND 256),
  latest_version_id text COLLATE "C",
  state text NOT NULL CHECK (state IN ('active', 'withdrawn', 'deleted', 'missing')),
  revision aw_connector.safe_integer NOT NULL,
  projection jsonb NOT NULL CHECK (jsonb_typeof(projection) = 'object'),
  PRIMARY KEY (source_id, scope_id, listing_id),
  UNIQUE (source_id, scope_id, source_listing_id),
  FOREIGN KEY (source_id, scope_id) REFERENCES aw_connector.inventories ON DELETE RESTRICT,
  FOREIGN KEY (source_id, latest_version_id, listing_id)
    REFERENCES aw_connector.listing_versions (source_id, listing_version_id, listing_id) ON DELETE RESTRICT
);

CREATE TABLE aw_connector.attempts (
  source_id aw_connector.source_id NOT NULL,
  run_id aw_connector.run_id NOT NULL,
  reservation_key aw_connector.operation_key NOT NULL,
  lease_fence aw_connector.safe_integer NOT NULL,
  page_ordinal integer NOT NULL CHECK (page_ordinal BETWEEN 0 AND 99999),
  attempt integer NOT NULL CHECK (attempt BETWEEN 0 AND 1000000),
  runtime_revision aw_connector.safe_integer NOT NULL,
  reservation jsonb NOT NULL CHECK (jsonb_typeof(reservation) = 'object'),
  completion_operation_key aw_connector.operation_key,
  completion jsonb CHECK (completion IS NULL OR jsonb_typeof(completion) = 'object'),
  PRIMARY KEY (source_id, run_id, reservation_key),
  UNIQUE (source_id, run_id, lease_fence, page_ordinal, attempt),
  FOREIGN KEY (source_id, run_id) REFERENCES aw_connector.runs ON DELETE RESTRICT,
  CHECK ((completion_operation_key IS NULL) = (completion IS NULL))
);

CREATE TABLE aw_connector.mutations (
  source_id aw_connector.source_id NOT NULL,
  run_id aw_connector.run_id NOT NULL,
  operation_key aw_connector.operation_key NOT NULL,
  kind text NOT NULL CHECK (kind IN ('run.opened', 'attempt.reserved', 'attempt.completed', 'raw.staged', 'page.committed', 'full.finalized', 'circuit.changed', 'run.terminal')),
  payload_sha256 aw_connector.digest NOT NULL,
  semantic_command text NOT NULL,
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  recorded_at aw_connector.utc_time NOT NULL,
  PRIMARY KEY (source_id, run_id, operation_key),
  FOREIGN KEY (source_id, run_id) REFERENCES aw_connector.runs ON DELETE RESTRICT
);
CREATE INDEX mutations_recorded_idx ON aw_connector.mutations (recorded_at, source_id, run_id);

CREATE TABLE aw_connector.outbox (
  source_id aw_connector.source_id NOT NULL,
  run_id aw_connector.run_id NOT NULL,
  operation_key aw_connector.operation_key NOT NULL,
  enqueued_at aw_connector.utc_time NOT NULL,
  PRIMARY KEY (source_id, run_id, operation_key),
  FOREIGN KEY (source_id, run_id, operation_key)
    REFERENCES aw_connector.mutations (source_id, run_id, operation_key) ON DELETE RESTRICT
);
CREATE INDEX outbox_enqueued_idx ON aw_connector.outbox (enqueued_at, source_id, run_id);

CREATE FUNCTION aw_connector.reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $immutable$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'immutable_connector_evidence';
END
$immutable$;
REVOKE ALL ON FUNCTION aw_connector.reject_immutable_mutation() FROM PUBLIC;

DO $triggers$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['raw_pages', 'listing_versions', 'observations', 'tombstones', 'mutations', 'outbox'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_evidence BEFORE UPDATE OR DELETE ON aw_connector.%I FOR EACH ROW EXECUTE FUNCTION aw_connector.reject_immutable_mutation()', relation_name);
    EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON aw_connector.%I FOR EACH STATEMENT EXECUTE FUNCTION aw_connector.reject_immutable_mutation()', relation_name);
  END LOOP;
END
$triggers$;

GRANT USAGE ON SCHEMA aw_connector TO aw_writer, aw_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA aw_connector TO aw_reader;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA aw_connector TO aw_writer;
GRANT UPDATE (lease_id, lease_fence, lease_run_id, expires_at, ttl_ms, installed_fence, runtime) ON aw_connector.sources TO aw_writer;
GRANT UPDATE (lease_fence, status, checkpoint_revision, checkpoint, completed_at) ON aw_connector.runs TO aw_writer;
GRANT UPDATE (generation_id, revision, head) ON aw_connector.inventories TO aw_writer;
GRANT UPDATE (latest_version_id, state, revision, projection) ON aw_connector.projections TO aw_writer;
GRANT UPDATE (completion_operation_key, completion) ON aw_connector.attempts TO aw_writer;
