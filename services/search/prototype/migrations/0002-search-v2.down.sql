LOCK TABLE aw_search.consumer, aw_search.batch, aw_search.attempt IN ACCESS EXCLUSIVE MODE;
DO $v2_empty$
BEGIN
  IF EXISTS (SELECT 1 FROM aw_search.batch WHERE mapping_version = 2)
    OR EXISTS (SELECT 1 FROM aw_search.attempt WHERE index_name ~ '^aw-v2-search-')
    OR EXISTS (SELECT 1 FROM aw_search.consumer WHERE index_name ~ '^aw-v2-search-') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'search_v2_schema_nonempty';
  END IF;
END
$v2_empty$;

REVOKE SELECT (raw_bytes) ON aw_connector.raw_pages FROM aw_search_worker;

CREATE OR REPLACE FUNCTION aw_search.publication() RETURNS jsonb
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
GRANT EXECUTE ON FUNCTION aw_search.publication() TO aw_search_api, aw_search_worker;

ALTER TABLE aw_search.batch DROP CONSTRAINT batch_mapping_version_check;
ALTER TABLE aw_search.batch ADD CONSTRAINT batch_mapping_version_check CHECK (mapping_version = 1);
ALTER TABLE aw_search.attempt DROP CONSTRAINT attempt_index_name_check;
ALTER TABLE aw_search.attempt ADD CONSTRAINT attempt_index_name_check CHECK (index_name ~ '^aw-v1-search-[a-f0-9]{32}$');
ALTER TABLE aw_search.consumer DROP CONSTRAINT consumer_index_name_check;
ALTER TABLE aw_search.consumer ADD CONSTRAINT consumer_index_name_check CHECK (index_name ~ '^aw-v1-search-[a-f0-9]{32}$');
