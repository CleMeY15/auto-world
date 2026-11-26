-- Private project catalog. Run with the authorized read-only role after checking the
-- current source grant. psql variables valid_from, valid_until, normalized_seconds and
-- media_seconds come from that grant. Set after to an empty string for the first page,
-- then use the last source_listing_id from that page. No other database is accessed.
WITH candidates AS (
    SELECT source_id COLLATE "C" AS source_id, source_listing_id COLLATE "C" AS source_listing_id, captured_at,
       CASE WHEN normalized_json#>>'{fields,price,status}' = 'observed' THEN normalized_json#>'{fields,price,value}' END AS price,
       CASE WHEN normalized_json->>'status' = 'listing'
            AND captured_at > CURRENT_TIMESTAMP - :'media_seconds'::integer * INTERVAL '1 second'
            AND normalized_json#>>'{photos,status}' = 'observed'
            THEN jsonb_path_query_array(normalized_json, '$.photos.values[0 to 199].url')
       END AS images,
       CASE WHEN normalized_json->>'status' IS DISTINCT FROM 'listing'
              OR normalized_json#>>'{photos,status}' IN ('observed', 'invalid', 'ambiguous')
            THEN captured_at END AS gallery_event_at,
       normalized_json->>'status' = 'listing' AS is_listing, 1 AS priority
    FROM aw_acquisition_trial.latest_listings
    WHERE source_id = 'leboncoin'
      AND source_listing_id ~ '^[1-9][0-9]{0,19}$'
      AND original_url = 'https://www.leboncoin.fr/ad/voitures/' || source_listing_id
      AND normalized_json#>>'{source,original_url}' = original_url
      AND normalized_json#>>'{source,listing_id}' = source_listing_id
      AND normalized_json#>>'{source,name}' = source_id
      AND normalized_json->>'schema_version' = 'leboncoin-replay/v1'
      AND captured_at >= :'valid_from'::timestamptz AND captured_at <= CURRENT_TIMESTAMP
      AND (captured_at > CURRENT_TIMESTAMP - :'normalized_seconds'::integer * INTERVAL '1 second'
           OR normalized_json->>'status' IS DISTINCT FROM 'listing')
    UNION ALL
    SELECT 'leboncoin'::text COLLATE "C" AS source_id, source_listing_id COLLATE "C" AS source_listing_id,
           exported_at AS captured_at, jsonb_build_object('currency', 'EUR', 'amountMinor', price_amount_minor) AS price,
           CASE WHEN media_observed_at >= :'valid_from'::timestamptz AND media_observed_at <= CURRENT_TIMESTAMP
                AND media_observed_at > CURRENT_TIMESTAMP - :'media_seconds'::integer * INTERVAL '1 second'
                AND media_retain_until > CURRENT_TIMESTAMP THEN to_jsonb(images[1:200]) END AS images,
           CASE WHEN media_observed_at <= CURRENT_TIMESTAMP
                THEN media_observed_at END AS gallery_event_at, true AS is_listing, 0 AS priority
    FROM aw_acquisition_trial.rust_export_listings
    WHERE source_listing_id ~ '^[1-9][0-9]{0,19}$'
      AND exported_at >= :'valid_from'::timestamptz AND exported_at <= CURRENT_TIMESTAMP
      AND exported_at > CURRENT_TIMESTAMP - :'normalized_seconds'::integer * INTERVAL '1 second'
), catalog AS (
    SELECT DISTINCT ON (source_id, source_listing_id)
        source_id, source_listing_id, captured_at, price, is_listing,
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
)
SELECT source_listing_id, record_origin, captured_at AS record_at,
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
WHERE is_listing AND CURRENT_TIMESTAMP >= :'valid_from'::timestamptz
  AND CURRENT_TIMESTAMP < :'valid_until'::timestamptz
  AND source_listing_id COLLATE "C" > :'after'
ORDER BY source_listing_id COLLATE "C"
LIMIT 100;
