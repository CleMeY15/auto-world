LOCK TABLE aw_search.consumer, aw_search.batch, aw_search.batch_event,
  aw_search.payload, aw_search.progress, aw_search.attempt, aw_search.quarantine,
  aw_search.replay_review, aw_search.delivery, aw_search.retired_index,
  aw_search.superseded_index IN ACCESS EXCLUSIVE MODE;
DO $empty$
BEGIN
  IF EXISTS (SELECT 1 FROM aw_search.batch) OR EXISTS (SELECT 1 FROM aw_search.delivery)
    OR EXISTS (SELECT 1 FROM aw_search.consumer WHERE fence <> 0 OR active_batch IS NOT NULL
      OR published_batch IS NOT NULL OR published_revision <> 0 OR halted OR lag_since IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'search_schema_nonempty';
  END IF;
END
$empty$;
DROP SCHEMA aw_search CASCADE;
