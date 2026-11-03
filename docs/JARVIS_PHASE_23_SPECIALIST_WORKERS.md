# JARVIS Phase 23 — Specialist Intelligence Workers

**Status:** CODE_COMPLETE (repository and automated-test scope; live device acceptance remains Phase 31)  
**Implementation branch:** feat/phase-23-specialist-workers  
**Product boundary:** One authenticated JARVIS runtime. Workers are internal modules, not separate agents, accounts, dashboards or services.

## Objective

Coordinate the eight specialist roles named in the JARVIS roadmap through one deterministic, permission-bounded dispatcher. Each worker has a declared purpose, allowed permissions, a narrow adapter and a recorded result. The security worker runs first and the verification worker runs last.

## Worker catalogue and actual capability boundary

- Security Worker: checks the request before any specialist runs. It blocks disallowed work and pauses consequential external operations for user approval.
- Research Worker: invokes the existing configured public-web research module. It returns HTTPS source metadata and a grounded answer only when the trusted search service is enabled. It does not bypass logins, CAPTCHAs or website restrictions.
- Coding Worker: prepares a deterministic local implementation and test plan. Repository writes, shell execution and generated-code execution are not available in this phase.
- Android Operator: prepares a plan only for supported local Android intents. It does not directly invoke Accessibility or device actions; the existing Android approval and action flow remains the execution boundary.
- Media Creation Worker: creates a real local storyboard draft through the existing Media Engine and stores it in the existing Media Studio collection. It does not claim image/video rendering or publication.
- Memory Worker: reads relevant active personal memory and trusted Knowledge entries. It cannot save or silently modify memory.
- Learning Worker: previews user-authored and user-reviewed learning context. It cannot store new lessons, train model weights or claim automatic fact-checking.
- Verification Worker: checks the status and required evidence from each assigned worker. Missing evidence produces needs_review, never a false completed result.

## Runtime lifecycle

1. Validate a bounded, privacy-screened task goal.
2. Select specialist roles using local deterministic intent rules, or validate an explicit worker list.
3. Create one persisted run with ordered worker checkpoints.
4. Run security preflight.
5. Execute selected specialists sequentially, checkpointing each result.
6. Stop on approval requirements, missing adapters or failures. Do not replay interrupted work automatically.
7. Run verification and mark the whole run completed only when its checks pass.
8. Keep a bounded run history under the authenticated JARVIS account.

## API

- GET /api/workers — authenticated catalogue, permissions and recent run history.
- GET /api/workers/runs/:id — authenticated detail for one run.
- POST /api/workers/dispatch — authenticated sequential dispatch; accepts a bounded goal and an optional list of operational worker IDs.

Worker run records are included in the user-controlled JARVIS data export. They are execution history, not new memory or model training.

## Safeguards

- One dispatcher at a time per server process; no concurrent specialist action races.
- Security preflight is mandatory, and public publishing, sending, purchases, payments, destructive file/account changes and security/permission changes pause before specialist side effects.
- Worker outputs are schema-normalized, length-bounded and sanitized; evidence links must be HTTPS and sensitive URL parameters are removed.
- No arbitrary tool names, shell commands, dynamic code, unbounded worker selection or generated executable modules are accepted.
- No automatic retries or replay after restart. A crashed run is preserved as needs_review.
- Optional external services are not made mandatory. Live public research is unavailable when the configured search service is disabled; this is reported as blocked.
- Device interaction remains permission-bound and must use the existing Android execution and verification flow.

## Verification checklist

- [x] Eight worker roles declared with purpose, permissions and boundaries.
- [x] Deterministic role selection and explicit role validation.
- [x] Central sequential orchestration and checkpoint callbacks.
- [x] Security-first and verification-last ordering.
- [x] Stop-on-failure and stop-on-approval-gate behavior.
- [x] Sanitized, bounded worker results and HTTPS evidence.
- [x] Interrupted-run review without automatic replay.
- [x] Authenticated worker catalogue, dispatch and run-detail endpoints.
- [x] Media storyboard adapter saves to the existing Media Studio store.
- [x] Memory and learning adapters are read-only.
- [x] Research and Android adapters report unavailable capabilities honestly.
- [x] Node unit and server integration tests.
- [x] Existing regression suite and production dependency audit.
- [x] Android CI build and APK verification.
- [ ] Physical Samsung Galaxy Tab A9 interaction/performance tests — Phase 31.

## Known limitations

The specialist roles are deterministic internal workers, not separate learned LLMs. Research depends on the existing trusted SearXNG configuration. Coding and Android operations are planning-only in this phase. Media creates an editable storyboard draft, not a rendered video. This phase does not claim general intelligence or broad autonomous operating-system access.
