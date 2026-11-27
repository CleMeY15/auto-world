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

-- Validate the raw/normalized pair at write time. The reader view only visits the projection.
CREATE OR REPLACE FUNCTION aw_acquisition_trial.valid_rust_vehicle_evidence(raw_bytes bytea, listings jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
    WITH vocabulary AS (
        SELECT $labels_v1${
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
}$labels_v1$::jsonb AS legacy, $labels_v2${
  "Alfa Romeo": ["159", "4C", "Brera", "Giulia", "Giulietta", "MiTo", "Spider", "Stelvio"],
  "Audi": ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q4", "Q5", "Q7", "Q8", "e-tron", "e-tron GT", "R8", "RS3", "RS4", "RS5", "RS6", "RS7", "RS Q3", "RS Q8", "S1", "S3", "S4", "S5", "S6", "S7", "S8", "SQ2", "SQ5", "SQ7", "SQ8", "TT", "TTS", "TT RS"],
  "BMW": ["1", "2", "3", "4", "5", "6", "7", "8", "X1", "X2", "X3", "X4", "X5", "X6", "X7", "Z3", "Z4", "i3", "i4", "i5", "i7", "i8", "iX", "M2", "M3", "M4", "M5", "M6", "M8", "X3 M", "X4 M", "X5 M", "X6 M"],
  "Citroën": ["C1", "C2", "C3", "C4", "C5", "C6", "C8", "Berlingo", "Jumpy", "Dispatch", "SpaceTourer", "Grand SpaceTourer", "Nemo", "Ami", "e-C4", "e-C3", "e-Berlingo", "C3 Aircross", "C4 Cactus", "C4 Picasso", "C4 SpaceTourer", "C5 Aircross", "C5 X"],
  "DS": ["DS 3", "DS 3 Crossback", "DS 4", "DS 7", "DS 7 Crossback", "DS 9"],
  "Dacia": ["Dokker", "Duster", "Jogger", "Lodgy", "Logan", "Sandero", "Spring"],
  "Fiat": ["500", "500C", "500L", "Bravo", "Ducato", "Fiorino", "Freemont", "Panda", "Punto", "Scudo", "Sedici"],
  "Ford": ["Fiesta", "Focus", "Fusion", "Mondeo", "Galaxy", "S-Max", "Kuga", "Puma", "Mustang", "Mustang Mach-E", "EcoSport", "Edge", "Explorer", "Transit", "Transit Custom", "Ranger", "Ka", "Ikon", "C-Max", "B-Max", "Granada", "Scorpio", "Sierra", "Pinto", "Capri", "Escort", "Taunus", "F-150", "Fiesta ST", "Focus ST", "Focus RS", "Kuga ST-Line"],
  "Honda": ["Accord", "Civic", "CR-V", "CR-Z", "HR-V", "Insight", "Jazz"],
  "Hyundai": ["i10", "i20", "i30", "i40", "ioniq", "ioniq 5", "ioniq 6", "Kona", "Tucson", "Santa Fe", "Santa Fe XL", "Sonata", "Elantra", "Accent", "Veloster", "Genesis", "Equus", "Trajet", "Starex", "H-1", "ix20", "ix35", "ix55", "Bayon", "Creta", "Venue", "Alcazar", "Exter"],
  "Jaguar": ["E-Pace", "F-Pace", "F-Type", "I-Pace", "XE", "XF", "XF Sportbrake", "XJ"],
  "Jeep": ["Cherokee", "Compass", "Grand Cherokee", "Renegade", "Wrangler", "Wrangler Unlimited"],
  "Kia": ["Picanto", "Rio", "Ceed", "Pro Ceed", "Stinger", "Sportage", "Sorento", "Soul", "Niro", "e-Niro", "EV6", "EV9", "Carnival", "Carens", "Venga", "Quoris", "K5", "K900", "Optima", "Cerato", "Forte", "Sedona", "Mohave", "Seltos", "XCeed", "XCeed GT", "Sportage GT-Line", "Ceed GT"],
  "Lancia": ["Delta", "Flavia", "Musa", "Thema", "Voyager", "Ypsilon"],
  "Land Rover": ["Defender", "Discovery", "Discovery Sport", "Freelander", "Range Rover", "Range Rover Evoque", "Range Rover Sport"],
  "Lexus": ["CT", "GS", "IS", "LFA", "LS", "NX", "RC", "RX"],
  "Mazda": ["2", "3", "5", "6", "CX-5", "CX-60", "MX-5", "MX-30"],
  "Mercedes": ["Citan", "CLA", "Classe A", "Classe B", "Classe C", "Classe E", "Classe G", "Classe M", "Classe S", "Classe V", "EQA", "EQB", "EQE", "EQS", "GLA", "GLB", "GLC", "GLE", "GLS", "Sprinter", "Vito"],
  "Mercedes-Benz": ["Citan", "CLA", "Classe A", "Classe B", "Classe C", "Classe E", "Classe G", "Classe M", "Classe S", "Classe V", "EQA", "EQB", "EQE", "EQS", "GLA", "GLB", "GLC", "GLE", "GLS", "Sprinter", "Vito"],
  "Mini": ["Aceman", "Cabrio", "Clubman", "Cooper", "Cooper Electric", "Countryman"],
  "Mitsubishi": ["ASX", "i-MiEV", "Outlander", "Pajero", "Space Star"],
  "Nissan": ["370Z", "Ariya", "GT-R", "Juke", "Leaf", "Micra", "Murano", "Note", "Pulsar", "Qashqai", "Townstar", "X-Trail"],
  "Opel": ["Corsa", "Astra", "Insignia", "Mokka", "Grandland", "Crossland", "Combo", "Zafira", "Meriva", "Vectra", "Omega", "Signum", "Agila", "Ampera", "Cascada", "Carl", "Frontra", "Kadett", "Manta", "Rekord", "Ascona", "GT", "Corsa-e", "Astra-e", "Mokka-e", "Ampera-e", "Combo Life", "Combo Van", "Zafira Life"],
  "Peugeot": ["208", "308", "2008", "3008", "5008", "207", "307", "407", "408", "508", "108", "107", "206", "306", "406", "607", "807", "Partner", "Expert", "Boxer", "Rifter", "Traveller", "e-208", "e-2008", "e-3008"],
  "Porsche": ["911", "Boxster", "Cayenne", "Cayman", "Macan", "Panamera", "Taycan"],
  "Renault": ["Clio", "Megane", "Talisman", "Kadjar", "Koleos", "Captur", "Arkana", "Austral", "Scenic", "Grand Scenic", "Modus", "Twingo", "Zoe", "Kangoo", "Master", "Trafic", "Symbol", "Logan", "Sandero", "Duster", "Fluence", "Laguna", "Safrane"],
  "Seat": ["Alhambra", "Altea", "Altea XL", "Arona", "Ateca", "Ibiza", "Ibiza ST", "Leon", "Leon SC", "Leon ST", "Mii", "Tarraco", "Toledo"],
  "Smart": ["forfour", "fortwo"],
  "Subaru": ["BRZ", "Forester", "Solterra", "WRX"],
  "Suzuki": ["Celerio", "Ignis", "Jimny", "Swace", "Swift", "Swift Sport", "SX4", "Vitara"],
  "Tesla": ["Model 3", "Model S", "Model X", "Model Y"],
  "Toyota": ["Yaris", "Corolla", "Auris", "C-HR", "Aygo", "Aygo X", "Rav4", "Land Cruiser", "Prado", "Highlander", "4Runner", "Sequoia", "Tacoma", "Tundra", "Camry", "Avalon", "Prius", "Prius+", "Verso", "Proace", "bZ4X", "Supra", "86", "Mirai", "Yaris Cross", "Corolla Cross", "Corolla Touring Sports", "Corolla Estate", "Corolla Hatchback"],
  "Volkswagen": ["Golf", "Polo", "Tiguan", "T-Roc", "T-Cross", "ID.3", "ID.4", "ID.5", "ID.7", "Passat", "Arteon", "Touareg", "Sharan", "Caddy", "Up!", "Beetle", "Jetta", "Bora", "Lupo", "Phaeton", "Scirocco", "Eos", "Corrado", "Golf GTI", "Golf R", "Golf Plus", "Golf Sportsvan", "Golf Variant", "Polo GTI", "Polo R", "Tiguan R"],
  "Volvo": ["S60", "S80", "V40", "V40 Cross Country", "V60", "V70", "XC60", "XC70", "XC90"],
  "Škoda": ["Citigo", "Fabia", "Kamiq", "Karoq", "Kodiaq", "Octavia", "Rapid", "Roomster", "Scala", "Superb", "Yeti"]
}$labels_v2$::jsonb AS current
    ), native AS (
        -- The raw JSON retains the number token. jsonb alone would round-trip 1e2 as the integer 100.
        SELECT record::jsonb AS item, (record#>'{sale_price_evidence,amount_minor}')::text AS cents_token,
               (record#>'{vehicle_features_evidence,attributes,doors}')::text AS doors_token,
               (record#>'{vehicle_features_evidence,attributes,seats}')::text AS seats_token
        FROM json_array_elements(convert_from(raw_bytes, 'UTF8')::json) record
    ), proofs AS (
        SELECT item->>'source_listing_id' AS listing_id, item->'source_listing_id' AS native_id,
               item->'vehicle_features_evidence' AS proof, doors_token, seats_token
        FROM native WHERE item ? 'vehicle_features_evidence'
    ), normalized AS (
        SELECT item FROM jsonb_array_elements(listings) item
    ), projections AS (
        SELECT item->>'source_listing_id' AS listing_id, item->'source_listing_id' AS normalized_id,
               item->'vehicle_features' AS features
        FROM normalized WHERE item ? 'vehicle_features'
    )
    SELECT (convert_from(raw_bytes, 'UTF8') IS JSON ARRAY WITH UNIQUE KEYS)
    AND (SELECT coalesce(
        bool_and(NOT (item ? 'vehicle_labels_version') AND NOT (item ? 'vehicle_features')) OR
        bool_and(coalesce((item->'vehicle_labels_version')::text = '2', false)), true) FROM normalized)
    AND NOT EXISTS (
        SELECT FROM native r FULL JOIN normalized n ON n.item->>'source_listing_id' = r.item->>'source_listing_id'
        CROSS JOIN vocabulary v
        WHERE r.item IS NULL OR n.item IS NULL
           OR jsonb_typeof(r.item->'source_listing_id') IS DISTINCT FROM 'string'
           OR r.item->'source_listing_id' IS DISTINCT FROM n.item->'source_listing_id'
           OR (CASE WHEN r.item ? 'vehicle_model_evidence' THEN
               (n.item->'vehicle_labels_version')::text = '2'
               AND jsonb_typeof(r.item->'marque') = 'string' AND jsonb_typeof(r.item->'modele') = 'string'
               AND n.item->'brand' = r.item->'marque' AND n.item->'model' = r.item->'modele'
               AND (v.current -> (n.item->>'brand')) ? (n.item->>'model')
               AND r.item->'vehicle_model_evidence' = jsonb_build_object(
                   'schema', 'searchData.ads.offer.model/v1', 'list_id', r.item->'source_listing_id',
                   'brand', r.item->'marque', 'model', r.item->'modele')
           ELSE
               (coalesce(n.item->'brand','null') = 'null' OR
                   (jsonb_typeof(n.item->'brand') = 'string' AND v.legacy ? (n.item->>'brand')
                    AND n.item->'brand' = r.item->'marque'))
               AND (coalesce(n.item->'model','null') = 'null' OR
                   (jsonb_typeof(n.item->'model') = 'string' AND jsonb_typeof(r.item->'modele') = 'string'
                    AND (r.item->>'modele') ~ '[^[:space:]]'
                    AND (v.legacy -> (n.item->>'brand')) ? (n.item->>'model')))
           END) IS NOT TRUE
           OR (CASE WHEN r.item ? 'sale_price_evidence' THEN
               CASE WHEN r.cents_token ~ '^[1-9][0-9]{0,13}00$'
                    THEN r.cents_token::bigint <= 9007199254740991 ELSE false END
               AND jsonb_typeof(r.item->'prix') = 'string'
               AND (r.item->>'prix') || '00' = r.cents_token
               AND (n.item->'price_amount_minor')::text = r.cents_token
               AND r.item->'sale_price_evidence' = jsonb_build_object(
                   'schema', 'searchData.ads.offer.price/v1', 'list_id', r.item->'source_listing_id',
                   'currency', 'EUR', 'amount_minor', n.item->'price_amount_minor')
           ELSE coalesce(n.item->'price_amount_minor','null') = 'null' END) IS NOT TRUE
    )
    AND NOT EXISTS (
        SELECT FROM proofs p FULL JOIN projections n USING (listing_id)
        WHERE p.listing_id IS NULL OR n.listing_id IS NULL
           OR jsonb_typeof(native_id) <> 'string' OR jsonb_typeof(normalized_id) <> 'string'
           OR jsonb_typeof(features) <> 'object'
           OR features = '{}'::jsonb
           OR proof IS DISTINCT FROM jsonb_build_object('schema', 'searchData.ads.offer.features/v1',
                                                        'list_id', n.listing_id, 'attributes', features)
           OR (proof->'attributes')::text IS DISTINCT FROM features::text
           OR (features ? 'doors' AND doors_token IS DISTINCT FROM (features->'doors')::text)
           OR (features ? 'seats' AND seats_token IS DISTINCT FROM (features->'seats')::text)
           OR EXISTS (
               SELECT FROM jsonb_each(CASE WHEN jsonb_typeof(features) = 'object' THEN features ELSE '{}'::jsonb END) f
               WHERE NOT CASE f.key
                   WHEN 'fuel' THEN jsonb_typeof(f.value) = 'string' AND f.value <@ '["Essence","Diesel","Électrique","Hybride","Hybride rechargeable","GPL","Bioéthanol","GNV","Hydrogène","Autre"]'::jsonb
                   WHEN 'gearbox' THEN jsonb_typeof(f.value) = 'string' AND f.value <@ '["Manuelle","Automatique","Semi-automatique"]'::jsonb
                   WHEN 'body' THEN jsonb_typeof(f.value) = 'string' AND f.value <@ '["Berline","Citadine","Break","SUV, 4x4 et pick-up","Coupé","Cabriolet","Monospace","Minibus","Utilitaire","Autre"]'::jsonb
                   WHEN 'color' THEN jsonb_typeof(f.value) = 'string' AND f.value <@ '["Argent","Beige","Blanc","Bleu","Bordeaux","Gris","Jaune","Marron","Noir","Orange","Rose","Rouge","Vert","Violet","Autre"]'::jsonb
                   WHEN 'upholstery' THEN jsonb_typeof(f.value) = 'string' AND f.value <@ '["Tissu","Tout cuir","Cuir partiel","Alcantara","Velours","Similicuir","Autre"]'::jsonb
                   WHEN 'doors' THEN jsonb_typeof(f.value) = 'number' AND f.value::text ~ '^[1-9]$'
                   WHEN 'seats' THEN jsonb_typeof(f.value) = 'number' AND f.value::text ~ '^[1-9]$'
                   WHEN 'firstOwner' THEN jsonb_typeof(f.value) = 'boolean'
                   WHEN 'inspectionValid' THEN jsonb_typeof(f.value) = 'boolean'
                   WHEN 'serviceBook' THEN jsonb_typeof(f.value) = 'boolean'
                   ELSE false END
           )
    )
$$;
COMMENT ON FUNCTION aw_acquisition_trial.valid_rust_vehicle_evidence(bytea,jsonb) IS 'autofind-private-rust-features/v1';
REVOKE ALL ON FUNCTION aw_acquisition_trial.valid_rust_vehicle_evidence(bytea,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION aw_acquisition_trial.guard_rust_vehicle_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- 0003 guards immutable row values and only permits monotonic suppression.
        -- Compare the JSON text as well: PostgreSQL jsonb equality treats 2 and 2.0 as equal.
        IF NEW.listings::text IS DISTINCT FROM OLD.listings::text
        THEN RAISE EXCEPTION 'immutable_native_export'; END IF;
        RETURN NEW;
    END IF;
    IF NOT aw_acquisition_trial.valid_rust_vehicle_evidence(NEW.raw_bytes, NEW.listings)
    THEN RAISE EXCEPTION 'invalid_native_vehicle_features'; END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION aw_acquisition_trial.guard_rust_vehicle_evidence() IS 'autofind-private-rust-features/v1';
REVOKE ALL ON FUNCTION aw_acquisition_trial.guard_rust_vehicle_evidence() FROM PUBLIC;
CREATE OR REPLACE TRIGGER guard_rust_vehicle_evidence BEFORE INSERT OR UPDATE ON aw_acquisition_trial.rust_exports
FOR EACH ROW EXECUTE FUNCTION aw_acquisition_trial.guard_rust_vehicle_evidence();
COMMENT ON TRIGGER guard_rust_vehicle_evidence ON aw_acquisition_trial.rust_exports
    IS 'autofind-private-rust-features/v1';

-- Installing the trigger locked out concurrent inserts. Check earlier exports before
-- exposing them, including a proof whose projection omitted the version during a downgrade.
DO $$ BEGIN
    IF EXISTS (
        SELECT FROM aw_acquisition_trial.rust_exports e
        WHERE NOT aw_acquisition_trial.valid_rust_vehicle_evidence(e.raw_bytes, e.listings)
    ) THEN RAISE EXCEPTION 'invalid_existing_vehicle_features'; END IF;
END $$;

CREATE OR REPLACE VIEW aw_acquisition_trial.catalog_dom_provenance WITH (security_barrier = true) AS
SELECT l.source_id, l.source_listing_id, l.original_url, l.captured_at, l.normalized_json,
    ARRAY(SELECT b.batch_id FROM aw_acquisition_trial.batch_entries b
          WHERE b.observation_sha256 = l.observation_sha256 AND b.source_listing_id = l.source_listing_id) AS batch_ids,
    l.observation_sha256 AS listing_observation_sha256
FROM aw_acquisition_trial.latest_listings l;

CREATE OR REPLACE VIEW aw_acquisition_trial.catalog_rust_provenance WITH (security_barrier = true) AS
WITH versions AS (
    SELECT e.export_sha256, e.exported_at, e.retain_until, r.*,
        r.source_listing_id = ANY(e.suppressed_listings) AS suppress_listing,
        r.source_listing_id = ANY(e.suppressed_galleries) AS suppress_gallery
    FROM aw_acquisition_trial.rust_exports e
    CROSS JOIN LATERAL jsonb_to_recordset(e.listings) AS r(
        source_listing_id text, brand text, model text, year integer, price_amount_minor bigint, mileage_km bigint,
        media_observed_at timestamptz, media_retain_until timestamptz, images text[], vehicle_features jsonb
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
    l.brand, l.model, l.year, l.price_amount_minor, l.mileage_km,
    CASE WHEN g.media_retain_until > CURRENT_TIMESTAMP AND g.retain_until > CURRENT_TIMESTAMP THEN g.images END AS images,
    l.export_sha256 AS listing_export, g.export_sha256 AS gallery_export, l.vehicle_features
FROM latest l LEFT JOIN gallery g USING (source_listing_id)
WHERE l.retain_until > CURRENT_TIMESTAMP;
COMMIT;
