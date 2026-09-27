# TASK-0005A — local SeaweedFS evidence retention and restore boundary

Status: PUBLIC_EVIDENCE_RETAINED / INCOMPLETE. This record preserves progress toward [ADR-0007](../decisions/ADR-0007-private-image-admission.md)'s second private copy. It does not establish a complete image archive, an offline restoration or admission.

## Verified local evidence, 27 September 2026

The existing ignored local archive now contains a digest-addressed directory named `seaweed-candidate-sha256-9739d848712cf40f158a9d44586b6166a0d51839eaeceebbadcad27980b1f504`. Its subject is `ghcr.io/clemey15/auto-world-seaweedfs-s3@sha256:9739d848712cf40f158a9d44586b6166a0d51839eaeceebbadcad27980b1f504`. Directory ACL inheritance is disabled and only the current administrator and SYSTEM have access. The archive is ignored, with no tracked `.omx` files.

- Original audit artifact `10934246908`: 453,587 bytes, SHA-256 `dd39a83ee38a53b0a45e03fd1d04f1f2e339302985bf3e10e8f7890f185a207f`, matching its GitHub API digest. All eight ZIP entries match the eight retained extracted reports byte for byte. The remote artifact expires on 11 October 2026; local retention does not depend on that expiration.
- Original publication receipt: 6,126 bytes, SHA-256 `695a063450a40b1abc477b11255ad54255c89c68bc4d1609d12f6865816ccb6f`. Its `FAILED/PUBLISHED_UNADMITTED` result is preserved.
- Original runtime failure artifact `10934517674` from run `36327798215`: 818 bytes, SHA-256 `c45bd74e68e63be79f47495db007cfaf1994d201474a0b6d001c48bbc882d406`. Its sole entry matches the retained 664-byte receipt, SHA-256 `c622135dca912dfd1d45754a05ef405136dd9cef907b63a41da750cf1560a130`. `PERSISTENCE_SERVICE_TWO/SECOND_READ_FAILED` remains failed; successful cleanup is not a runtime PASS.
- Separate runtime failure artifact `10935600132` from run `36328954895`: 823 bytes, SHA-256 `4201c6066f172b3b1f2df8680619115440f6791a9591e58a5734b8a4655cede2`. Its sole entry matches the retained 669-byte receipt, SHA-256 `9c9bb8b011947deafdb95ad73211b230a2dd1b7d53ab2fe87c6a4af13e412355`. `BACKUP_RESTORED_SERVICE/RESTORED_READ_FAILED` is a second failed attempt; neither receipt is overwritten or restated as a complete runtime proof.
- Full Git history bundle for runtime recipe main `0ddbf9e2ce37dae1efc9d56f894e751481142777`, tree `fab1c46798c9e1cb10703abf565f50774af2baae`: 5,435,856 bytes, SHA-256 `6c7bda0ebb93340c69d2ccd3686c827a6096f1fbbdd64405e95267f5b62d31a9`. `git bundle verify` confirms complete history. This preserves the exact recipe revision; it is not a claim that all external recipe materials have been archived.
- Additional full Git history bundle for main `135d6b187ee90a0171ba9aeeaed45a8ed1084c2d`, tree `86f1fc9decb336ec0a60f849ea177a246fe1a904`: 5,428,389 bytes, SHA-256 `00ed78a37c2f8056b6ae338e0ea1c344056c9ccf43858d73763f70253a9d0949`, with complete history confirmed by `git bundle verify`. The earlier bundle remains intact.
- The five previously retained source ZIPs remain in `seaweed-source-35884717093`, referenced without duplicating approximately 3 GB. Their source retention manifest has SHA-256 `bd63357c82a325092b417bfce8d1fafde39c83af52e786617abea370a5fd5eec`.

The local manifest records individual sizes and hashes, `PUBLIC_EVIDENCE_ONLY`, `INCOMPLETE` and `NOT_AUTHORIZED`. It is kept in ignored storage, not published with local account information. No image archive, credential or private registry layer has been uploaded as a public Actions artifact.

## Concrete next restore slice

1. Establish an authorized local read-only package credential and a compatible Linux Docker engine. The current local OAuth scopes lack `read:packages`; no Docker command, service or installation was found on this workstation. Do not infer a token expansion or silently choose a new host installation.
2. Retrieve the exact manifest subject and retain a complete loadable image archive with its manifest/configuration identities. Validate the full saved archive, image ID, DiffID, filesystem and runtime configuration against the already reviewed candidate policy. No tag substitution or rebuilt image may stand in for the stored subject.
3. Complete the digest-addressed image/evidence/source/notices/SBOM/recipe inventory, preserving original bytes and distinct publication, audit and runtime results. Record explicit support dates before any activation; the retention commitment is supported lifetime plus 365 days, with no automatic deletion.
4. Demonstrate restoration from the retained copy on a clean, compatible Linux Docker engine, without registry download as a fallback. Verify loaded identity and rerun the five existing runtime profiles, including isolated data backup/restore and all owned-resource cleanup. Retain the bounded restoration receipt locally.
5. Only after complete retrieval/restoration proof proceed to the separately reviewed official attestation, consumer admission and four-service lifecycle integration.

Earlier native diagnostics exercised isolated data backup/restore on other disposable image IDs; they do not prove recovery of this image/evidence archive after registry loss. Both exact-subject runtime runs failed and readiness repair remains in progress. Missing package-read authority, the local engine choice and complete restoration evidence remain explicit boundaries. No new account, storage service, dependency or token scope has been introduced by this retention step.

Rollback preserves these files and all prior evidence. It does not delete source ZIPs, revoke or rewrite historical receipts, change a remote package, or admit a candidate. TASK-0005A and TASK-0005 remain IN_PROGRESS; TASK-0006 remains blocked.
