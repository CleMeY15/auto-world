
DO $aw_trial$ BEGIN
 IF current_database()<>'autoworld' THEN RAISE EXCEPTION 'wrong_database'; END IF;
 IF to_regnamespace('aw_acquisition_trial') IS NOT NULL
    AND to_regclass('aw_acquisition_trial.metadata') IS NULL THEN
   RAISE EXCEPTION 'unrecognized_trial_schema';
 END IF;
END $aw_trial$;
SELECT pg_advisory_xact_lock(109624,137100);
CREATE SCHEMA IF NOT EXISTS aw_acquisition_trial;
REVOKE ALL ON SCHEMA aw_acquisition_trial FROM PUBLIC;
CREATE TABLE IF NOT EXISTS aw_acquisition_trial.metadata (key text PRIMARY KEY,value text NOT NULL);
CREATE TABLE IF NOT EXISTS aw_acquisition_trial.batches (
 batch_id text PRIMARY KEY,bundle_sha256 text NOT NULL,source_revision text NOT NULL,
 run_id text NOT NULL,plan_sha256 text NOT NULL,created_at timestamptz NOT NULL,summary_json jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS aw_acquisition_trial.raw_observations (
 observation_sha256 text PRIMARY KEY CHECK (observation_sha256 ~ '^[a-f0-9]{64}$'),
 source_id text NOT NULL CHECK (source_id='leboncoin'),source_listing_id text NOT NULL,
 original_url text NOT NULL,captured_at timestamptz NOT NULL,raw_bytes bytea NOT NULL,
 byte_length integer NOT NULL CHECK (byte_length=octet_length(raw_bytes)),
 CHECK (source_listing_id ~ '^[1-9][0-9]{0,19}$'),
 CHECK (original_url='https://www.leboncoin.fr/ad/voitures/' || source_listing_id),
 CHECK (encode(sha256(raw_bytes),'hex')=observation_sha256));
CREATE TABLE IF NOT EXISTS aw_acquisition_trial.observations (
 observation_sha256 text PRIMARY KEY REFERENCES aw_acquisition_trial.raw_observations,
 normalized_json jsonb NOT NULL CHECK (jsonb_typeof(normalized_json)='object'));
CREATE TABLE IF NOT EXISTS aw_acquisition_trial.batch_entries (
 batch_id text NOT NULL REFERENCES aw_acquisition_trial.batches,source_listing_id text NOT NULL,
 observation_sha256 text NOT NULL REFERENCES aw_acquisition_trial.observations,
 capture_sha256 text NOT NULL CHECK (capture_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(batch_id,source_listing_id));
CREATE INDEX IF NOT EXISTS raw_listing_history ON aw_acquisition_trial.raw_observations(source_id,source_listing_id,captured_at);
CREATE OR REPLACE VIEW aw_acquisition_trial.latest_listings AS
 SELECT DISTINCT ON (source_id,source_listing_id)
 source_id,source_listing_id,original_url,captured_at,observation_sha256,normalized_json
 FROM aw_acquisition_trial.raw_observations JOIN aw_acquisition_trial.observations USING(observation_sha256)
 ORDER BY source_id,source_listing_id,captured_at DESC,observation_sha256 DESC;
CREATE TEMP TABLE aw_trial_expected (
 source_listing_id text PRIMARY KEY,observation_sha256 text UNIQUE,original_url text,captured_at timestamptz,
 raw_bytes bytea,byte_length integer,normalized_json jsonb,capture_sha256 text) ON COMMIT DROP;
