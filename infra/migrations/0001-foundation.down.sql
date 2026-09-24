-- ACCESS EXCLUSIVE locks prevent a concurrent writer after the empty-state check.
LOCK TABLE aw_foundation.source_reference, aw_foundation.connector_run_reference,
  aw_foundation.raw_snapshot_reference, aw_foundation.vehicle_candidate,
  aw_foundation.listing, aw_foundation.listing_version, aw_foundation.observation,
  aw_foundation.listing_version_observation, aw_foundation.outbox_event,
  aw_foundation.outbox_delivery IN ACCESS EXCLUSIVE MODE;
DO $empty$
DECLARE relation_name text; populated boolean;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['source_reference', 'connector_run_reference', 'raw_snapshot_reference', 'vehicle_candidate', 'listing', 'listing_version', 'observation', 'listing_version_observation', 'outbox_event', 'outbox_delivery'] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM aw_foundation.%I)', relation_name) INTO populated;
    IF populated THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'rollback_nonempty';
    END IF;
  END LOOP;
END
$empty$;
DROP TABLE aw_foundation.outbox_delivery;
DROP TABLE aw_foundation.outbox_event;
DROP TABLE aw_foundation.listing_version_observation;
DROP TABLE aw_foundation.observation;
DROP TABLE aw_foundation.listing_version;
DROP TABLE aw_foundation.listing;
DROP TABLE aw_foundation.vehicle_candidate;
DROP TABLE aw_foundation.raw_snapshot_reference;
DROP TABLE aw_foundation.connector_run_reference;
DROP TABLE aw_foundation.source_reference;
DROP FUNCTION aw_foundation.reject_evidence_mutation();
DROP DOMAIN aw_foundation.utc_time;
DROP DOMAIN aw_foundation.digest;
DROP DOMAIN aw_foundation.observation_id;
DROP DOMAIN aw_foundation.listing_id;
DROP DOMAIN aw_foundation.vehicle_id;
DROP DOMAIN aw_foundation.raw_id;
DROP DOMAIN aw_foundation.run_id;
DROP DOMAIN aw_foundation.source_id;
DROP SCHEMA aw_foundation;
