WITH candidates AS (
    SELECT source_id COLLATE "C" AS source_id, source_listing_id COLLATE "C" AS source_listing_id, captured_at,
       CASE WHEN normalized_json#>>'{fields,brand,status}' = 'observed' THEN normalized_json#>'{fields,brand,value}' END AS brand,
       CASE WHEN normalized_json#>>'{fields,model,status}' = 'observed' THEN normalized_json#>'{fields,model,value}' END AS model,
       CASE WHEN normalized_json#>>'{fields,model_year,status}' = 'observed' THEN normalized_json#>'{fields,model_year,value}' END AS year,
       CASE WHEN normalized_json#>>'{fields,mileage,status}' = 'observed' THEN normalized_json#>'{fields,mileage,value}' END AS mileage,
       CASE WHEN normalized_json#>>'{fields,price,status}' = 'observed' THEN normalized_json#>'{fields,price,value}' END AS price,
       CASE WHEN batch_ids && %(dom_batch_ids)s::text[] AND normalized_json->>'status' = 'listing'
            AND captured_at > CURRENT_TIMESTAMP - %(media_seconds)s::integer * INTERVAL '1 second'
            AND normalized_json#>>'{photos,status}' = 'observed'
            THEN jsonb_path_query_array(normalized_json, '$.photos.values[0 to 199].url')
       END AS images,
       CASE WHEN normalized_json->>'status' IS DISTINCT FROM 'listing'
              OR normalized_json#>>'{photos,status}' IN ('observed', 'invalid', 'ambiguous')
            THEN captured_at END AS gallery_event_at,
       batch_ids && %(dom_batch_ids)s::text[] AND normalized_json->>'status' = 'listing' AS is_listing, 1 AS priority
    FROM aw_acquisition_trial.catalog_dom_provenance
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
           CASE WHEN gallery_export = ANY(%(export_ids)s::text[]) AND media_observed_at >= %(valid_from)s::timestamptz AND media_observed_at <= CURRENT_TIMESTAMP
                AND media_observed_at > CURRENT_TIMESTAMP - %(media_seconds)s::integer * INTERVAL '1 second'
                AND media_retain_until > CURRENT_TIMESTAMP THEN to_jsonb(images[1:200]) END AS images,
           CASE WHEN media_observed_at <= CURRENT_TIMESTAMP
                THEN media_observed_at END AS gallery_event_at, listing_export = ANY(%(export_ids)s::text[]) AS is_listing, 0 AS priority
    FROM aw_acquisition_trial.catalog_rust_provenance
    WHERE source_listing_id ~ '^[1-9][0-9]{0,19}$'
      AND exported_at >= %(valid_from)s::timestamptz AND exported_at <= CURRENT_TIMESTAMP
      AND exported_at > CURRENT_TIMESTAMP - %(normalized_seconds)s::integer * INTERVAL '1 second'
), catalog AS (
    SELECT DISTINCT ON (source_id, source_listing_id)
        source_id, source_listing_id, captured_at, brand, model, year, mileage, price, is_listing,
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
SELECT source_listing_id, record_origin, captured_at AS record_at, brand, model,
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
), labelled AS (
    SELECT p.source_listing_id, p.record_origin, p.record_at, p.record_time_kind,
           v.brand, m.model, p.year, p.mileage_km, p.price_amount_minor, p.photo_references
    FROM projected p
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
  AND (NOT %(hasPrice)s OR price_amount_minor IS NOT NULL)
  AND (%(priceMin)s::bigint IS NULL OR price_amount_minor >= %(priceMin)s::bigint * 100)
  AND (%(priceMax)s::bigint IS NULL OR price_amount_minor <= %(priceMax)s::bigint * 100)
  AND (%(yearMin)s::integer IS NULL OR year >= %(yearMin)s)
  AND (%(yearMax)s::integer IS NULL OR year <= %(yearMax)s)
  AND (%(kmMax)s::bigint IS NULL OR mileage_km <= %(kmMax)s)
ORDER BY source_listing_id COLLATE "C"
LIMIT %(page_size)s::integer;
