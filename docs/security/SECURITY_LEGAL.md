# SECURITY, PRIVACY & LEGAL ORCHESTRATION

## Prototype sequencing exception

[ADR-0028](../decisions/ADR-0028-v1-prototype-functional-gate.md) records the user's deferral of remaining TASK-0005/TASK-0005A image/scanner qualification until a usable functional V1. It no longer blocks isolated application development on fabricated data after the accepted functional milestone. It does not waive source rights, secret handling, loopback/isolation, data integrity, ordinary dependency checks or security review of newly changed application boundaries. Keep known findings and resume release qualification at that V1 milestone, before any public deployment, production, supported activation or real-data use. Never describe deferred image qualification as passed.

## Source gate
No production source without documented authorization basis and redistribution/caching rules. Legal review must cover database rights, copyright/media, ToS/API terms, personal data and territorial restrictions.

## Privacy by design
Minimize seller personal data. Separate professional dealer data from private seller PII. Retention schedule. Access controls. DSAR/export/delete workflow. Audit trail for admin access.

## Scraping governance
Even publicly accessible personal data scraping requires privacy safeguards. Respect contractual/technical restrictions and legal assessment. Never design bypass of authentication, CAPTCHAs or access controls as a product requirement.

## Security baseline
MFA for admins; least privilege; secret manager; encryption transit/at-rest; backups + restore drills; WAF/rate limiting; SAST/dependency scanning; signed CI provenance where practical.

## Connector SDK trust boundaries

The [V1 connector contract](../decisions/ADR-0003-connector-sdk-contract.md) treats adapter bytes, mapper drafts and port receipts as untrusted runtime input. Bounded strict UTF-8/JSON decoding rejects duplicate keys and prototype-oriented payloads; defensive descriptor-based snapshots reject accessors and detach mutable nested values. Provenance and internal VIN policy are constructed by the SDK, never accepted from external listing text. Diagnostics and telemetry use fixed codes and allowlisted metadata only.

Authenticated current policy/evidence and durable fenced transactions remain injected trusted capabilities, not promises that a marker or interface can verify. Before production, independently validate those capabilities, least-privilege access, streaming resource limits, lawful retention, takedown, source-health dashboards and alerts. No credentials, real source access or deployed security controls are introduced by TASK-0004.
