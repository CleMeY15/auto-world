# SECURITY, PRIVACY & LEGAL ORCHESTRATION

## Source gate
No production source without documented authorization basis and redistribution/caching rules. Legal review must cover database rights, copyright/media, ToS/API terms, personal data and territorial restrictions.

## Privacy by design
Minimize seller personal data. Separate professional dealer data from private seller PII. Retention schedule. Access controls. DSAR/export/delete workflow. Audit trail for admin access.

## Scraping governance
Even publicly accessible personal data scraping requires privacy safeguards. Respect contractual/technical restrictions and legal assessment. Never design bypass of authentication, CAPTCHAs or access controls as a product requirement.

## Security baseline
MFA for admins; least privilege; secret manager; encryption transit/at-rest; backups + restore drills; WAF/rate limiting; SAST/dependency scanning; signed CI provenance where practical.
