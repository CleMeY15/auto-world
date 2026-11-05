-- ACCESS EXCLUSIVE locks prevent a writer from racing the empty-state check.
LOCK TABLE aw_connector.sources, aw_connector.runs, aw_connector.inventories,
  aw_connector.raw_pages, aw_connector.listing_versions, aw_connector.observations,
  aw_connector.tombstones, aw_connector.projections, aw_connector.attempts,
  aw_connector.mutations, aw_connector.outbox IN ACCESS EXCLUSIVE MODE;

DO $empty$
DECLARE relation_name text; populated boolean;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['sources', 'runs', 'inventories', 'raw_pages', 'listing_versions', 'observations', 'tombstones', 'projections', 'attempts', 'mutations', 'outbox'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM aw_connector.%I)', relation_name) INTO populated;
    IF populated THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'rollback_nonempty';
    END IF;
  END LOOP;
END
$empty$;

DROP TABLE aw_connector.outbox;
DROP TABLE aw_connector.mutations;
DROP TABLE aw_connector.attempts;
DROP TABLE aw_connector.projections;
DROP TABLE aw_connector.tombstones;
DROP TABLE aw_connector.observations;
DROP TABLE aw_connector.listing_versions;
DROP TABLE aw_connector.raw_pages;
DROP TABLE aw_connector.inventories;
DROP TABLE aw_connector.runs;
DROP TABLE aw_connector.sources;
DROP FUNCTION aw_connector.reject_immutable_mutation();
DROP DOMAIN aw_connector.utc_time;
DROP DOMAIN aw_connector.safe_integer;
DROP DOMAIN aw_connector.operation_key;
DROP DOMAIN aw_connector.digest;
DROP DOMAIN aw_connector.snapshot_id;
DROP DOMAIN aw_connector.run_id;
DROP DOMAIN aw_connector.source_id;
DROP SCHEMA aw_connector;
