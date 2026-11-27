BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(109624, 137100);
DO $$ BEGIN
    IF current_database() <> 'autoworld'
       OR obj_description('aw_acquisition_trial.rust_exports'::regclass, 'pg_class')
          IS DISTINCT FROM 'aw-leboncoin-native-export/v1'
       OR obj_description('aw_acquisition_trial.catalog_rust_provenance'::regclass, 'pg_class')
          IS DISTINCT FROM 'autofind-catalog-publication/v1'
       OR obj_description('aw_acquisition_trial.catalog_dom_provenance'::regclass, 'pg_class')
          IS DISTINCT FROM 'autofind-catalog-publication/v1'
    THEN RAISE EXCEPTION 'wrong_project_catalogue'; END IF;
END $$;

DO $$
DECLARE object record;
BEGIN
    FOR object IN SELECT * FROM (VALUES
        (to_regprocedure('aw_acquisition_trial.valid_rust_vehicle_evidence(bytea,jsonb)')::oid, 'pg_proc'),
        (to_regprocedure('aw_acquisition_trial.guard_rust_vehicle_evidence()')::oid, 'pg_proc'),
        ((SELECT oid FROM pg_trigger WHERE tgrelid = 'aw_acquisition_trial.rust_exports'::regclass
             AND tgname = 'guard_rust_vehicle_evidence'), 'pg_trigger')
    ) objects(id, catalog) LOOP
        IF object.id IS NOT NULL AND obj_description(object.id, object.catalog::name)
             IS DISTINCT FROM 'autofind-private-rust-features/v1'
        THEN RAISE EXCEPTION 'unexpected_existing_feature_guard'; END IF;
    END LOOP;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_attribute
                   WHERE attrelid = 'aw_acquisition_trial.catalog_rust_provenance'::regclass
                     AND attname = 'vehicle_features' AND atttypid = 'jsonb'::regtype AND NOT attisdropped)
       OR NOT EXISTS (SELECT FROM pg_attribute
                   WHERE attrelid = 'aw_acquisition_trial.catalog_dom_provenance'::regclass
                     AND attname = 'listing_observation_sha256' AND atttypid = 'text'::regtype AND NOT attisdropped)
    THEN RAISE EXCEPTION 'feature_view_not_installed'; END IF;
END $$;

-- PostgreSQL keeps dependent objects, owner and ACLs on CREATE OR REPLACE.
-- This compatibility slot stays NULL when the feature is disabled.
CREATE OR REPLACE VIEW aw_acquisition_trial.catalog_dom_provenance WITH (security_barrier = true) AS
SELECT l.source_id, l.source_listing_id, l.original_url, l.captured_at, l.normalized_json,
    ARRAY(SELECT b.batch_id FROM aw_acquisition_trial.batch_entries b
          WHERE b.observation_sha256 = l.observation_sha256 AND b.source_listing_id = l.source_listing_id) AS batch_ids,
    NULL::text AS listing_observation_sha256
FROM aw_acquisition_trial.latest_listings l;

CREATE OR REPLACE VIEW aw_acquisition_trial.catalog_rust_provenance WITH (security_barrier = true) AS
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
    SELECT DISTINCT ON (source_listing_id) source_listing_id, export_sha256, media_observed_at, media_retain_until, images, retain_until
    FROM versions WHERE images IS NOT NULL AND NOT suppress_gallery
    ORDER BY source_listing_id, media_observed_at DESC, (cardinality(images) = 0) DESC, exported_at DESC, export_sha256
)
SELECT l.source_listing_id, l.exported_at, g.media_observed_at, least(g.media_retain_until, g.retain_until) AS media_retain_until,
    l.brand, CASE WHEN ($labels_v1${
  "Alfa Romeo": [],
  "Audi": ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q4", "Q5", "Q7", "Q8", "e-tron", "e-tron GT", "R8", "RS3", "RS4", "RS5", "RS6", "RS7", "RS Q3", "RS Q8", "S1", "S3", "S4", "S5", "S6", "S7", "S8", "SQ2", "SQ5", "SQ7", "SQ8", "TT", "TTS", "TT RS"],
  "BMW": ["1", "2", "3", "4", "5", "6", "7", "8", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "Z3", "Z4", "i3", "i4", "i5", "i7", "i8", "iX", "M2", "M3", "M4", "M5", "M6", "M8", "X3 M", "X4 M", "X5 M", "X6 M"],
  "Citroën": ["C1", "C2", "C3", "C4", "C5", "C6", "C8", "Berlingo", "Jumpy", "Dispatch", "SpaceTourer", "Grand SpaceTourer", "Nemo", "Ami", "e-C4", "e-C3", "e-Berlingo", "C3 Aircross", "C4 Cactus", "C4 Picasso", "C4 SpaceTourer", "C5 Aircross", "C5 X"],
  "DS": [],
  "Dacia": [],
  "Fiat": [],
  "Ford": ["Fiesta", "Focus", "Fusion", "Mondeo", "Galaxy", "S-Max", "Kuga", "Puma", "Mustang", "Mustang Mach-E", "EcoSport", "Edge", "Explorer", "Transit", "Transit Custom", "Ranger", "Ka", "Ikon", "C-Max", "B-Max", "Granada", "Scorpio", "Sierra", "Pinto", "Capri", "Escort", "Taunus", "F-150", "Fiesta ST", "Focus ST", "Focus RS", "Kuga ST-Line"],
  "Honda": [],
  "Hyundai": ["i10", "i20", "i30", "i40", "ioniq", "ioniq 5", "ioniq 6", "Kona", "Tucson", "Santa Fe", "Santa Fe XL", "Sonata", "Elantra", "Accent", "Veloster", "Genesis", "Equus", "Trajet", "Starex", "H-1", "ix20", "ix35", "ix55", "Bayon", "Creta", "Venue", "Alcazar", "Exter"],
  "Jaguar": [],
  "Jeep": [],
  "Kia": ["Picanto", "Rio", "Ceed", "Pro Ceed", "Stinger", "Sportage", "Sorento", "Soul", "Niro", "e-Niro", "EV6", "EV9", "Carnival", "Carens", "Venga", "Quoris", "K5", "K900", "Optima", "Cerato", "Forte", "Sedona", "Mohave", "Seltos", "XCeed", "XCeed GT", "Sportage GT-Line", "Ceed GT"],
  "Lancia": [],
  "Land Rover": [],
  "Lexus": [],
  "Mazda": [],
  "Mercedes": [],
  "Mercedes-Benz": [],
  "Mini": [],
  "Mitsubishi": [],
  "Nissan": [],
  "Opel": ["Corsa", "Astra", "Insignia", "Mokka", "Grandland", "Crossland", "Combo", "Zafira", "Meriva", "Vectra", "Omega", "Signum", "Agila", "Ampera", "Cascada", "Carl", "Frontra", "Kadett", "Manta", "Rekord", "Ascona", "GT", "Corsa-e", "Astra-e", "Mokka-e", "Ampera-e", "Combo Life", "Combo Van", "Zafira Life"],
  "Peugeot": ["208", "308", "2008", "3008", "5008", "207", "307", "407", "408", "508", "108", "107", "206", "306", "406", "607", "807", "Partner", "Expert", "Boxer", "Rifter", "Traveller", "e-208", "e-2008", "e-3008"],
  "Porsche": [],
  "Renault": ["Clio", "Megane", "Talisman", "Kadjar", "Koleos", "Captur", "Arkana", "Austral", "Scenic", "Grand Scenic", "Modus", "Twingo", "Zoe", "Kangoo", "Master", "Trafic", "Symbol", "Logan", "Sandero", "Duster", "Fluence", "Laguna", "Safrane"],
  "Seat": [],
  "Smart": [],
  "Subaru": [],
  "Suzuki": [],
  "Tesla": [],
  "Toyota": ["Yaris", "Corolla", "Auris", "C-HR", "Aygo", "Aygo X", "Rav4", "Land Cruiser", "Prado", "Highlander", "4Runner", "Sequoia", "Tacoma", "Tundra", "Camry", "Avalon", "Prius", "Prius+", "Verso", "Proace", "bZ4X", "Supra", "86", "Mirai", "Yaris Cross", "Corolla Cross", "Corolla Touring Sports", "Corolla Estate", "Corolla Hatchback"],
  "Volkswagen": ["Golf", "Polo", "Tiguan", "T-Roc", "T-Cross", "ID.3", "ID.4", "ID.5", "ID.7", "Passat", "Arteon", "Touareg", "Sharan", "Caddy", "Up!", "Beetle", "Jetta", "Bora", "Lupo", "Phaeton", "Scirocco", "Eos", "Corrado", "Golf GTI", "Golf R", "Golf Plus", "Golf Sportsvan", "Golf Variant", "Polo GTI", "Polo R", "Tiguan R"],
  "Volvo": [],
  "Škoda": []
}$labels_v1$::jsonb -> l.brand) ? l.model THEN l.model END AS model,
    l.year, l.price_amount_minor, l.mileage_km,
    CASE WHEN g.media_retain_until > CURRENT_TIMESTAMP AND g.retain_until > CURRENT_TIMESTAMP THEN g.images END AS images,
    l.export_sha256 AS listing_export, g.export_sha256 AS gallery_export, NULL::jsonb AS vehicle_features
FROM latest l LEFT JOIN gallery g USING (source_listing_id)
WHERE l.retain_until > CURRENT_TIMESTAMP;

DROP TRIGGER IF EXISTS guard_rust_vehicle_evidence ON aw_acquisition_trial.rust_exports;
DROP FUNCTION IF EXISTS aw_acquisition_trial.guard_rust_vehicle_evidence();
DROP FUNCTION IF EXISTS aw_acquisition_trial.valid_rust_vehicle_evidence(bytea,jsonb);
COMMIT;
