WITH candidates AS (
    SELECT source_id COLLATE "C" AS source_id, source_listing_id COLLATE "C" AS source_listing_id, captured_at,
       CASE WHEN normalized_json#>>'{fields,brand,status}' = 'observed' THEN normalized_json#>'{fields,brand,value}' END AS brand,
       CASE WHEN normalized_json#>>'{fields,model,status}' = 'observed' THEN normalized_json#>'{fields,model,value}' END AS model,
       CASE WHEN normalized_json#>>'{fields,model_year,status}' = 'observed' THEN normalized_json#>'{fields,model_year,value}' END AS year,
       CASE WHEN normalized_json#>>'{fields,mileage,status}' = 'observed' THEN normalized_json#>'{fields,mileage,value}' END AS mileage,
       CASE WHEN normalized_json#>>'{fields,price,status}' = 'observed' THEN normalized_json#>'{fields,price,value}' END AS price,
       normalized_json->'criteria' AS feature_source,
       CASE WHEN normalized_json->>'observation_sha256' = to_jsonb(dom)->>'listing_observation_sha256'
            THEN normalized_json->>'observation_sha256' END AS feature_evidence_sha,
       CASE WHEN batch_ids && %(dom_batch_ids)s::text[] AND normalized_json->>'status' = 'listing'
            AND captured_at > CURRENT_TIMESTAMP - %(media_seconds)s::integer * INTERVAL '1 second'
            AND normalized_json#>>'{photos,status}' = 'observed'
            THEN jsonb_path_query_array(normalized_json, '$.photos.values[0 to 199].url')
       END AS images,
       CASE WHEN normalized_json->>'status' IS DISTINCT FROM 'listing'
              OR normalized_json#>>'{photos,status}' IN ('observed', 'invalid', 'ambiguous')
            THEN captured_at END AS gallery_event_at,
       batch_ids && %(dom_batch_ids)s::text[] AND normalized_json->>'status' = 'listing' AS is_listing, 1 AS priority
    FROM aw_acquisition_trial.catalog_dom_provenance AS dom
    WHERE source_id = 'leboncoin'
      AND source_listing_id ~ '^[1-9][0-9]{0,19}$'
      AND original_url = 'https://www.leboncoin.fr/ad/voitures/' || source_listing_id
      AND normalized_json#>>'{source,original_url}' = original_url
      AND normalized_json#>>'{source,listing_id}' = source_listing_id
      AND normalized_json#>>'{source,name}' = source_id
      AND normalized_json->>'schema_version' = 'leboncoin-replay/v1'
      AND captured_at >= %(valid_from)s::timestamptz AND captured_at <= CURRENT_TIMESTAMP
      AND (captured_at > CURRENT_TIMESTAMP - %(normalized_seconds)s::integer * INTERVAL '1 second'
           OR normalized_json->>'status' IS DISTINCT FROM 'listing')
    UNION ALL
    SELECT 'leboncoin'::text COLLATE "C" AS source_id, source_listing_id COLLATE "C" AS source_listing_id,
           exported_at AS captured_at, to_jsonb(brand), to_jsonb(model), to_jsonb(year),
           jsonb_build_object('unit', 'km', 'amount', mileage_km), jsonb_build_object('currency', 'EUR', 'amountMinor', price_amount_minor) AS price,
           -- Older installations of the provenance view have no vehicle_features column.
           CASE WHEN EXISTS (
               SELECT 1 FROM pg_attribute WHERE attrelid = 'aw_acquisition_trial.catalog_rust_provenance'::regclass
                 AND attname = 'vehicle_features' AND NOT attisdropped
           ) THEN to_jsonb(rust)->'vehicle_features' END,
           NULL::text,
           CASE WHEN gallery_export = ANY(%(export_ids)s::text[]) AND media_observed_at >= %(valid_from)s::timestamptz AND media_observed_at <= CURRENT_TIMESTAMP
                AND media_observed_at > CURRENT_TIMESTAMP - %(media_seconds)s::integer * INTERVAL '1 second'
                AND media_retain_until > CURRENT_TIMESTAMP THEN to_jsonb(images[1:200]) END AS images,
           CASE WHEN media_observed_at <= CURRENT_TIMESTAMP
                THEN media_observed_at END AS gallery_event_at, listing_export = ANY(%(export_ids)s::text[]) AS is_listing, 0 AS priority
    FROM aw_acquisition_trial.catalog_rust_provenance AS rust
    WHERE source_listing_id ~ '^[1-9][0-9]{0,19}$'
      AND exported_at >= %(valid_from)s::timestamptz AND exported_at <= CURRENT_TIMESTAMP
      AND exported_at > CURRENT_TIMESTAMP - %(normalized_seconds)s::integer * INTERVAL '1 second'
), catalog AS (
    SELECT DISTINCT ON (source_id, source_listing_id)
        source_id, source_listing_id, captured_at, brand, model, year, mileage, price, is_listing, feature_source, feature_evidence_sha,
        CASE WHEN priority = 1 THEN 'legacy_dom' ELSE 'rust_export' END AS record_origin,
        first_value(CASE
            WHEN history.media_event_at IS NULL OR gallery_event_at > history.media_event_at
              OR (gallery_event_at = history.media_event_at AND priority = 1 AND NOT history.withdrawn)
            THEN images END) OVER (
            PARTITION BY source_id, source_listing_id
            ORDER BY gallery_event_at DESC NULLS LAST, priority DESC
        ) AS images
    FROM candidates
    LEFT JOIN aw_acquisition_trial.catalog_media_history AS history USING (source_id, source_listing_id)
    ORDER BY source_id, source_listing_id, priority DESC, captured_at DESC
),
projected AS (
SELECT source_listing_id, record_origin, captured_at AS record_at, brand, model, feature_source, feature_evidence_sha,
       CASE WHEN jsonb_typeof(year) = 'number' AND year::text ~ '^[0-9]{4}$' AND year::text >= '1886'
            THEN year::text::integer END AS year,
       CASE WHEN mileage->>'unit' = 'km' AND jsonb_typeof(mileage->'amount') = 'number'
                 AND mileage->>'amount' ~ '^[0-9]{1,16}$'
            THEN CASE WHEN (mileage->>'amount')::bigint <= 9007199254740991
                      THEN (mileage->>'amount')::bigint END END AS mileage_km,
       CASE WHEN record_origin = 'rust_export' THEN 'file_export' ELSE 'source_capture' END AS record_time_kind,
       CASE WHEN price->>'currency' = 'EUR' AND jsonb_typeof(price->'amountMinor') = 'number'
                 AND price->>'amountMinor' ~ '^[0-9]{1,16}$'
            THEN CASE WHEN (price->>'amountMinor')::bigint <= 9007199254740991
                      THEN (price->>'amountMinor')::bigint END END AS price_amount_minor,
       ARRAY(
           SELECT url FROM (
               SELECT DISTINCT ON (split_part(url, '?', 1)) url, ordinal
               FROM jsonb_array_elements_text(images) WITH ORDINALITY refs(url, ordinal)
               WHERE url ~ $cdn$^https://img\.leboncoin\.fr/api/v1/lbcpb1/images/(?:(?:[0-9a-f]{2}/){3}(?:[0-9a-f]{40}\.jpg|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})|gh/(?:[0-9a-f]{2}/){2}gh[0-9a-f]{38}\.jpg)(?:\?rule=[A-Za-z0-9_-]{1,100})?$$cdn$
               ORDER BY split_part(url, '?', 1), ordinal
           ) accepted ORDER BY ordinal
       ) AS photo_references
FROM catalog
WHERE is_listing AND CURRENT_TIMESTAMP >= %(valid_from)s::timestamptz
  AND CURRENT_TIMESTAMP < %(valid_until)s::timestamptz
  AND (%(listing_id)s = '' OR source_listing_id = %(listing_id)s)
), vocabulary AS (
    SELECT key AS brand, value AS models FROM jsonb_each(%(vehicle_vocabulary)s::jsonb)
), feature_candidates AS (
    SELECT p.*, CASE WHEN p.record_origin = 'rust_export' THEN p.feature_source ELSE
        jsonb_build_object(
            'fuel', %(dom_options)s::jsonb->'fuel'->lower(criteria->>'fuel'),
            'gearbox', %(dom_options)s::jsonb->'gearbox'->lower(criteria->>'gearbox'),
            'body', %(dom_options)s::jsonb->'body'->lower(criteria->>'vehicle_type'),
            'color', %(dom_options)s::jsonb->'color'->lower(criteria->>'vehicule_color'),
            'upholstery', %(dom_options)s::jsonb->'upholstery'->lower(criteria->>'vehicle_upholstery'),
            'doors', CASE WHEN criteria->>'doors' ~ '^[1-9]$' THEN (criteria->>'doors')::integer END,
            'seats', CASE WHEN criteria->>'seats' ~ '^[1-9]$' THEN (criteria->>'seats')::integer END,
            'firstOwner', CASE WHEN criteria->>'vehicle_history' = 'Première main' THEN true END,
            'inspectionValid', CASE criteria->>'vehicle_technical_inspection_valid' WHEN 'Oui' THEN true WHEN 'Non' THEN false END,
            'serviceBook', CASE WHEN 'Carnet d''entretien disponible' = ANY(string_to_array(criteria->>'vehicle_maintenance', ', '))
                 AND string_to_array(criteria->>'vehicle_maintenance', ', ') <@
                     ARRAY['Carnet d''entretien disponible', 'Factures disponibles', 'Véhicule non fumeur'] THEN true END
        ) END AS feature_values
    FROM projected p
    LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(key, value) AS criteria FROM (
            SELECT entry->>'key' AS key, min(btrim(entry->>'value')) AS value
            FROM jsonb_array_elements(CASE WHEN p.record_origin = 'legacy_dom' AND jsonb_typeof(p.feature_source) = 'array'
                                           THEN p.feature_source ELSE '[]' END) WITH ORDINALITY AS attrs(entry, position)
            WHERE %(dom_labels)s::jsonb ? (entry->>'key')
            GROUP BY entry->>'key'
            HAVING count(*) = 1 AND bool_and(coalesce(
                entry->>'label' = %(dom_labels)s::jsonb->>(entry->>'key')
                AND jsonb_typeof(entry->'value') = 'string'
                AND entry#>'{evidence,raw}' = entry->'value'
                AND p.feature_evidence_sha ~ '^[a-f0-9]{64}$'
                AND entry#>>'{evidence,observation_sha256}' = p.feature_evidence_sha
                AND entry#>>'{evidence,json_pointer}' = '/criteria/' || (position - 1)::text || '/value'
                AND entry#>>'{evidence,selector}' = 'main [data-qa-id^="criteria_item_"]', false))
        ) accepted
    ) dom ON p.record_origin = 'legacy_dom'
), labelled AS (
    SELECT p.source_listing_id, p.record_origin, p.record_at, p.record_time_kind,
           v.brand, m.model, p.year, p.mileage_km, p.price_amount_minor, p.photo_references,
           coalesce(features.vehicle_features, '{}'::jsonb) AS vehicle_features
    FROM feature_candidates p
    LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(key, value) AS vehicle_features
        FROM jsonb_each(CASE WHEN jsonb_typeof(p.feature_values) = 'object' THEN p.feature_values ELSE '{}' END) AS f
        WHERE CASE WHEN %(filter_options)s::jsonb ? key THEN jsonb_typeof(value) = 'string'
                        AND (%(filter_options)s::jsonb->key) ? (value #>> '{}')
                   WHEN key IN ('doors', 'seats') THEN jsonb_typeof(value) = 'number' AND value::text ~ '^[1-9]$'
                   WHEN key IN ('firstOwner', 'inspectionValid', 'serviceBook') THEN jsonb_typeof(value) = 'boolean'
              END
    ) features ON true
    LEFT JOIN vocabulary v ON jsonb_typeof(p.brand) = 'string'
                          AND lower(v.brand) = lower(btrim(p.brand #>> '{}'))
    LEFT JOIN LATERAL (
        SELECT model FROM jsonb_array_elements_text(v.models) AS model_names(model)
        WHERE jsonb_typeof(p.model) = 'string' AND lower(model) = lower(btrim(p.model #>> '{}'))
    ) m ON true
)
SELECT * FROM labelled
WHERE source_listing_id COLLATE "C" > %(after)s
  AND (%(search)s = '' OR strpos(lower(concat_ws(' ', brand, model, year, source_listing_id)), lower(%(search)s)) > 0)
  AND (%(brand)s = '' OR lower(brand) = lower(%(brand)s))
  AND (%(model)s = '' OR lower(model) = lower(%(model)s))
  AND (NOT %(hasPrice)s OR price_amount_minor IS NOT NULL)
  AND (NOT %(hasPhotos)s OR cardinality(photo_references) > 0)
  AND vehicle_features @> %(required_features)s::jsonb
  AND (%(seatsMin)s::integer IS NULL OR (vehicle_features->>'seats')::integer >= %(seatsMin)s)
  AND (%(seatsMax)s::integer IS NULL OR (vehicle_features->>'seats')::integer <= %(seatsMax)s)
  AND (%(priceMin)s::bigint IS NULL OR price_amount_minor >= %(priceMin)s::bigint * 100)
  AND (%(priceMax)s::bigint IS NULL OR price_amount_minor <= %(priceMax)s::bigint * 100)
  AND (%(yearMin)s::integer IS NULL OR year >= %(yearMin)s)
  AND (%(yearMax)s::integer IS NULL OR year <= %(yearMax)s)
  AND (%(kmMin)s::bigint IS NULL OR mileage_km >= %(kmMin)s)
  AND (%(kmMax)s::bigint IS NULL OR mileage_km <= %(kmMax)s)
ORDER BY source_listing_id COLLATE "C"
LIMIT %(page_size)s::integer;
