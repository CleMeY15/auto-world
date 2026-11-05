CREATE SCHEMA aw_search AUTHORIZATION aw_migrator;
REVOKE ALL ON SCHEMA aw_search FROM PUBLIC;

CREATE TABLE aw_search.batch (
  batch_id text PRIMARY KEY CHECK (batch_id ~ '^[a-f0-9]{32}$'),
  mapping_version integer NOT NULL CHECK (mapping_version = 1),
  metadata jsonb,
  payload_sha256 text CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  document_count integer NOT NULL CHECK (document_count BETWEEN 0 AND 10000),
  rebuild boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE aw_search.batch_event (
  batch_id text NOT NULL REFERENCES aw_search.batch,
  source_id text NOT NULL,
  run_id text NOT NULL,
  operation_key text NOT NULL,
  PRIMARY KEY (batch_id, source_id, run_id, operation_key),
  FOREIGN KEY (source_id, run_id, operation_key) REFERENCES aw_connector.outbox
);
CREATE TABLE aw_search.payload (
  batch_id text PRIMARY KEY REFERENCES aw_search.batch,
  snapshot jsonb NOT NULL CHECK (octet_length(snapshot::text) <= 40000000)
);
CREATE TABLE aw_search.progress (
  batch_id text PRIMARY KEY REFERENCES aw_search.batch,
  cycle integer NOT NULL DEFAULT 0 CHECK (cycle BETWEEN 0 AND 1000),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE aw_search.attempt (
  batch_id text NOT NULL REFERENCES aw_search.batch,
  cycle integer NOT NULL CHECK (cycle BETWEEN 0 AND 1000),
  number integer NOT NULL CHECK (number BETWEEN 1 AND 5),
  index_name text NOT NULL UNIQUE CHECK (index_name ~ '^aw-v1-search-[a-f0-9]{32}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (batch_id, cycle, number)
);
CREATE TABLE aw_search.quarantine (
  quarantine_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id text NOT NULL REFERENCES aw_search.batch,
  cycle integer NOT NULL,
  code text NOT NULL CHECK (code IN ('projection_invalid', 'projection_limit', 'search_unavailable', 'attempts_exhausted')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (batch_id, cycle)
);
CREATE TABLE aw_search.retired_index (
  index_name text PRIMARY KEY REFERENCES aw_search.attempt(index_name),
  retired_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE aw_search.superseded_index (
  index_name text PRIMARY KEY REFERENCES aw_search.attempt(index_name),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE aw_search.replay_review (
  quarantine_id bigint PRIMARY KEY REFERENCES aw_search.quarantine,
  review_ref text NOT NULL CHECK (review_ref ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE aw_search.delivery (
  source_id text NOT NULL,
  run_id text NOT NULL,
  operation_key text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('projected', 'noop')),
  batch_id text REFERENCES aw_search.batch,
  PRIMARY KEY (source_id, run_id, operation_key),
  FOREIGN KEY (source_id, run_id, operation_key) REFERENCES aw_connector.outbox,
  CHECK ((disposition = 'projected') = (batch_id IS NOT NULL))
);
CREATE TABLE aw_search.consumer (
  id integer PRIMARY KEY CHECK (id = 1),
  checkpoint_version integer NOT NULL DEFAULT 1 CHECK (checkpoint_version = 1),
  fence bigint NOT NULL DEFAULT 0 CHECK (fence BETWEEN 0 AND 9007199254740991),
  active_batch text REFERENCES aw_search.batch,
  published_batch text REFERENCES aw_search.batch,
  published_revision bigint NOT NULL DEFAULT 0 CHECK (published_revision BETWEEN 0 AND 9007199254740991),
  index_name text CHECK (index_name ~ '^aw-v1-search-[a-f0-9]{32}$'),
  halted boolean NOT NULL DEFAULT false,
  lag_since timestamptz,
  CHECK ((published_batch IS NULL) = (index_name IS NULL))
);
INSERT INTO aw_search.consumer (id) VALUES (1);

CREATE FUNCTION aw_search.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'immutable_search_evidence'; END
$immutable$;
REVOKE ALL ON FUNCTION aw_search.immutable() FROM PUBLIC;
DO $triggers$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['batch','batch_event','attempt','quarantine','replay_review','delivery','retired_index','superseded_index'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON aw_search.%I FOR EACH ROW EXECUTE FUNCTION aw_search.immutable()', relation);
    EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON aw_search.%I FOR EACH STATEMENT EXECUTE FUNCTION aw_search.immutable()', relation);
  END LOOP;
END
$triggers$;

-- One statement gives readers a coherent pointer + pending state, without
-- granting them access to raw, canonical data, event identities or credentials.
CREATE FUNCTION aw_search.publication() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $publication$
  SELECT CASE WHEN c.published_batch IS NULL THEN NULL ELSE jsonb_build_object(
    'indexName', c.index_name, 'revision', c.published_revision, 'snapshot', b.metadata,
    'documentCount', b.document_count,
    'pendingRelevant', c.halted OR EXISTS (
      SELECT 1 FROM aw_connector.outbox o
      JOIN aw_connector.mutations m USING (source_id, run_id, operation_key)
      JOIN aw_connector.runs r USING (source_id, run_id)
      WHERE o.source_id = 'src_sdk_synthetic'
        AND r.scope_id = 'scope_7d18dbe77c718e18cb036fbb21b1658a783498188d5b547ed5c5413a5c743414'
        AND m.kind IN ('page.committed', 'full.finalized')
        AND NOT EXISTS (SELECT 1 FROM aw_search.delivery d
          WHERE (d.source_id,d.run_id,d.operation_key) = (o.source_id,o.run_id,o.operation_key))
    )) END
  FROM aw_search.consumer c LEFT JOIN aw_search.batch b ON b.batch_id = c.published_batch
  WHERE c.id = 1
$publication$;
REVOKE ALL ON FUNCTION aw_search.publication() FROM PUBLIC;
GRANT USAGE ON SCHEMA aw_search TO aw_search_worker, aw_search_api;
GRANT EXECUTE ON FUNCTION aw_search.publication() TO aw_search_api, aw_search_worker;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA aw_search TO aw_search_worker;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA aw_search TO aw_search_worker;
GRANT UPDATE (fence,active_batch,published_batch,published_revision,index_name,halted,lag_since) ON aw_search.consumer TO aw_search_worker;
GRANT UPDATE (cycle,next_attempt_at) ON aw_search.progress TO aw_search_worker;
GRANT DELETE ON aw_search.payload TO aw_search_worker;

GRANT USAGE ON SCHEMA aw_connector TO aw_search_worker;
GRANT SELECT (source_id,run_id,scope_id,lease_fence,checkpoint) ON aw_connector.runs TO aw_search_worker;
GRANT SELECT (source_id,scope_id,generation_id,revision,head) ON aw_connector.inventories TO aw_search_worker;
GRANT SELECT (source_id,scope_id,listing_id,source_listing_id,latest_version_id,state,revision,projection) ON aw_connector.projections TO aw_search_worker;
GRANT SELECT (source_id,run_id,listing_id,listing_version_id,source_listing_id,snapshot_id,raw_sha256,listing,evidence) ON aw_connector.listing_versions TO aw_search_worker;
GRANT SELECT (source_id,run_id,listing_id,observation_id,listing_version_id,snapshot_id,raw_sha256,observation) ON aw_connector.observations TO aw_search_worker;
GRANT SELECT (source_id,run_id,scope_id,tombstone_id,listing_id,source_listing_id,kind,snapshot_id,raw_sha256,evidence) ON aw_connector.tombstones TO aw_search_worker;
GRANT SELECT (source_id,run_id,snapshot_id,sha256,pending) ON aw_connector.raw_pages TO aw_search_worker;
GRANT SELECT (source_id,run_id,operation_key,kind,receipt,recorded_at) ON aw_connector.mutations TO aw_search_worker;
GRANT SELECT (source_id,run_id,operation_key,enqueued_at) ON aw_connector.outbox TO aw_search_worker;
