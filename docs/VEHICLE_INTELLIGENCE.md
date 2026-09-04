# Vehicle Intelligence Architecture

## Objective
Turn heterogeneous listings into a trustworthy decision layer. Listing data is evidence about a vehicle, not the vehicle itself.

## Core model
- VehicleEntity: canonical real-world vehicle candidate.
- Listing: marketplace/dealer publication.
- Observation: immutable time-stamped fact seen from a source.
- Provenance: source, observed_at, acquisition method, confidence, license/status.
- IdentityEvidence: VIN/full or permitted derivative, source IDs, dealer stock IDs, fingerprints.
- SpecObservation: technical/emissions facts.
- HistoryEvent: price/km/seller/country/listing lifecycle observations.
- ExternalReportProvider: provider capability and routing/contract status.

## Resolution pipeline
Raw -> Listing -> Normalize -> Identity Resolver -> Vehicle Graph -> Specs/Emissions -> History -> Trust -> Pricing -> Registration/Import -> Search/API.

## Vehicle History
Support internal observation history and external providers independently. Histovec, CarVertical and other names are integrations/routes only when their terms, APIs or affiliate arrangements permit. Never scrape or reproduce a protected report without rights. When direct data access is unavailable, expose a transparent outbound action to the provider.

## VIN
VIN is high-value and potentially sensitive/contract-restricted depending on source/context. Store/use only where lawful and necessary. Maintain source and access policy. Never fabricate missing VIN characters. VIN decoding results are observations with provenance, not unconditional truth.

## Specs & emissions
Canonical fields include power_kw, power_hp, displacement_cc, fuel, transmission, drivetrain, mass, euro_standard, co2_wltp, co2_nedc when relevant, consumption, EV range, first_registration and fiscal_power where supported. Resolve by VIN first when reliable, then exact variant, then model/generation fallback with decreasing confidence. Do not mix WLTP and NEDC silently.

## French registration engine
Use a versioned rules engine. Inputs and outputs must declare rule_version and effective date. Prefer official French sources for rates/rules. Separate fixed taxes, regional tax, applicable reductions/exemptions and environmental components. Ask only for missing user inputs. Imported vehicles require a separate decision path because first registration, origin, approval/homologation and environmental taxation can materially change the result.

## Import / landed cost
Return a breakdown rather than one opaque number. Distinguish seller country, vehicle origin, customs origin/proof, EU/non-EU status, VAT situation, transport, homologation and registration. If a mandatory fact is unknown, return a range or `needs_input`, not false precision.

## Trust Score
Trust != Deal. Signals may include identity contradictions, implausible mileage chronology, duplicate photos, cross-source inconsistencies and price anomalies. Output reasons and confidence. Use neutral wording such as `inconsistency detected` rather than accusing a seller of fraud.

## Golden datasets
Maintain reviewed fixtures for VIN resolution, model taxonomy, duplicate pairs/non-pairs, specs, emissions, tax calculations and import scenarios. CI/evals must detect regressions.

## User correction loop
Corrections are suggestions until validated. Preserve audit history and never silently rewrite original source evidence.
