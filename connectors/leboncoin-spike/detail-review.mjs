/** Conservative review hints on an existing normalized detail observation. */
export function reviewDetailClaims(result) {
  if (result.status !== "listing") return [];
  const { title, model_year: modelYear, issuance_date: registration } = result.fields;
  const segments = title.value.split(/[,;|]|\s+[–—-]\s+/u).map((part) => part.trim());
  const notes = [];

  // A separate four-digit segment or an explicitly labelled model year can
  // describe the car. Ignore dates embedded in service, warranty or CT text.
  const yearClaims = new Set();
  for (const [index, segment] of segments.entries()) {
    const explicit = /^(?:année modèle|millésime)\s*:?\s*((?:19|20)\d{2})$/iu.exec(segment);
    // Common listing headline: "Model – 2021 – 385 ch – ...".
    const headline = /^(?:19|20)\d{2}$/u.test(segment)
      && index > 0 && /^\d{2,4}\s*(?:ch|cv|kw)$/iu.test(segments[index + 1] ?? "");
    if (explicit || headline) yearClaims.add(Number(explicit?.[1] ?? segment));
  }
  if (yearClaims.size === 1 && modelYear.status === "observed" && registration.status === "observed"
    && modelYear.value === registration.value.year && !yearClaims.has(modelYear.value)) {
    notes.push({ field: "model_year", reason: "title_year_differs_from_both_structured_years",
      title_claim: [...yearClaims][0], structured_model_year: modelYear.value,
      first_registration_year: registration.value.year });
  }

  // Match the entire phrase. "CT pas OK", "ancien CT OK" and "CT OK ?"
  // alone do not establish a positive claim about current validity.
  const inspectionMentions = segments.filter((part) => /\bCT\b|contrôle technique/iu.test(part));
  const inspectionText = inspectionMentions[0];
  const claimIndex = segments.indexOf(inspectionText);
  const previous = segments[claimIndex - 1] ?? "";
  // A trailing unrecognised clause may qualify the claim, e.g. "en 2018".
  // Only known, independent headline attributes may follow it.
  const trailers = segments.slice(claimIndex + 1);
  const independentAttribute = /^(?:garantie\s+\d+\s+(?:ans?|mois)|entretien à jour|bo[iî]te (?:manuelle|automatique)|[\d.\s]+\s*km)$/iu;
  const previouslyQualified = /(?:\b(?:en|depuis|jusqu.en)\s+(?:19|20)\d{2}|\b(?:mais|sauf|ancien(?:nement)?|autrefois|précédemment|avant|expiré|périmé)\b)/iu.test(previous);
  const claimsPositiveCT = inspectionMentions.length === 1
    && /^(?:CT|contrôle technique)\s+(?:OK|valide)$/iu.test(inspectionText)
    && !previouslyQualified && trailers.every((part) => independentAttribute.test(part));
  const inspection = result.criteria.filter((item) => item.key === "vehicle_technical_inspection_valid");
  if (claimsPositiveCT && inspection.length > 0
    && inspection.every((item) => item.label === "Contrôle technique valide" && item.value === "Non")) {
    notes.push({ field: "vehicle_technical_inspection_valid", reason: "positive_title_negative_criterion",
      title_claim: "positive", structured_value: "Non" });
  }
  return notes;
}
