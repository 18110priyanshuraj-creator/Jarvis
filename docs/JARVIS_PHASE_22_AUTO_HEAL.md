# JARVIS Phase 22 — Proactive Auto-Heal Engine

**Status:** CODE_COMPLETE (repository scope; physical Samsung Galaxy Tab A9 acceptance remains Phase 31)  
**Core implementation PR:** [#71](https://github.com/18110priyanshuraj-creator/Jarvis/pull/71), merged at `aa6f708f1f0559a2132bfd04c77100b0f55c5390`  
**Dashboard and closeout follow-up:** [#72](https://github.com/18110priyanshuraj-creator/Jarvis/pull/72)

## Goal

Detect workflow failures, preserve a privacy-minimized incident record, and propose narrowly scoped, testable runtime-configuration adjustments. A repair never applies itself. The owner reviews and confirms every application or rollback.

## What is implemented

- Failed workflow runs are captured as sanitized incidents. Incident fingerprints prevent repeated scans from creating duplicate records.
- The incident scanner can reconcile previously saved workflow history when the owner presses **Inspect workflows**.
- The supported runtime configuration is deliberately small:
  - Workflow step timeout: 10,000–120,000 ms (default 60,000 ms).
  - Manual per-step retry cap: 1–3 attempts (default 3, including the original attempt).
- The only generated repair proposal supported in this phase is a 15,000 ms timeout increase, capped at 120,000 ms. Unsupported failure categories remain manual-review-only.
- Proposals pass strict exact-shape and range validation before being saved as `tested`.
- Applying a proposal requires explicit confirmation and the exact state revision from which the proposal was generated. A stale proposal cannot overwrite a newer setting; competing proposals based on the same previous revision are invalidated.
- Every application stores before/after values and an incremented revision in bounded history.
- Rollback requires explicit confirmation, the exact applied revision, and an unchanged current configuration. If another change has happened since application, rollback fails closed rather than overwriting it.
- The workflow runtime consumes the approved timeout and manual retry cap. Retries remain manual; there is no automatic replay after an error or restart.
- The dashboard exposes incident inspection, supported proposal creation, validation status, approval/application, rollback, and change history.

## API

All routes require the authenticated JARVIS session:

- `GET /api/auto-heal` — no-store status, configuration, incidents, proposals, history and limits.
- `POST /api/auto-heal/inspect` — reconcile incidents from saved failed workflow runs.
- `POST /api/auto-heal/incidents/:id/propose` — create a tested proposal only for a supported timeout incident.
- `POST /api/auto-heal/proposals/:id/approve` — apply a proposal with `expectedRevision` and `confirm: true`.
- `POST /api/auto-heal/proposals/:id/rollback` — restore the previous configuration with `expectedRevision` and `confirm: true`.

## Security and limitations

This is a bounded runtime-configuration repair engine, not unrestricted self-modifying software.

- It cannot edit repository/source files, execute JavaScript or shell commands, load modules, access arbitrary files, or make external network/integration/device actions.
- It cannot alter passwords, API keys, OAuth credentials, storage paths, permissions, database schema, or deployment settings.
- It never retries a failed workflow automatically and never resumes an interrupted run without the existing explicit review/resume step.
- Only timeout incidents have a repair recipe. Rate limits, network failures, missing configuration, permissions, invalid input and unknown failures are recorded with sanitized guidance and require manual resolution.
- A larger timeout is not proof that the underlying service is healthy; the owner must inspect the failed step and verify its outcome before choosing a manual retry.
- This phase does not claim source-code self-patching, automatic bug-fixing, automatic fact-checking or autonomous production deployment.

## Verification

Core implementation PR #71 merged at `aa6f708f1f0559a2132bfd04c77100b0f55c5390`. Post-merge GitHub Actions run [41604274714](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41604274714) passed:

- Node suite: 281 passed, 0 failed.
- Production dependency audit: 0 vulnerabilities.
- Android Companion unit tests and debug build passed.
- APK integrity verification and artifact upload passed.

Automated coverage includes default/range validation, rejection of extra settings, sanitization and incident de-duplication, unsupported repair classes, proposal testing, explicit confirmation, expected-revision checks, stale proposal invalidation, configuration application, rollback preconditions and history. Server integration coverage verifies unauthenticated access is rejected, failed runs create sanitized incidents, unsupported proposals do not mutate state, and authenticated inspection is idempotent.

Dashboard wiring, authenticated API guard tests and Phase 22 closeout documentation are included in PR #72, merged into main at 39643564e8e01c39272b2f4b4cdac8030605fee9. Post-merge main CI run 41606205186 passed on retry attempt 2: the Node.js test/dependency-audit job and Android Companion build/APK-verification job both completed successfully. The first Android attempt encountered Maven Central HTTP 429 while downloading a Robolectric artifact; retrying that one job resolved the transient dependency-host rate limit.

Physical Samsung Galaxy Tab A9 workflow failure, review, apply and rollback acceptance remains Phase 31. This document does not claim the tablet has been tested.
