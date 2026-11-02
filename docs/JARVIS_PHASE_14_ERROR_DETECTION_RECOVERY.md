# JARVIS Phase 14 — Error Detection and Recovery

**Status:** VERIFIED — merged via PR #53 at `11acb45`; the PR source passed full Node and Android CI, and the merged `main` tree is identical.  
**Branch:** `feat/phase-14-error-detection-recovery`  
**Base:** `123a9dc39030c73449c1abb0c1756a6acc78ce37`

## Goal

Detect workflow failures, explain their likely category using a bounded safe taxonomy, and offer only recovery actions that do not silently repeat unsafe or ambiguous work.

## Scope delivered in this phase

- Workflow-step errors are mapped to a small stable taxonomy:
  - transient: `timeout`, `rate_limited`, `service_unavailable`, `network_unavailable`, `storage_conflict`
  - action required: `authentication_required`, `permission_denied`, `configuration_missing`, `endpoint_not_found`, `resource_limit`, `invalid_request`, `handler_missing`
  - needs review: `unknown`
- Every failed step receives a sanitized failure object with code, category, retryability, generic guidance, timestamp and bounded attempt count. Run-level execution failures receive the same classification.
- Raw exception/provider response text, credentials and untrusted error bodies are not copied into the workflow recovery record. Existing error fields are populated with fixed guidance text for compatibility with the dashboard.
- Only known transient failure categories are eligible for retry. Unknown failures and configuration, credential, permission, endpoint, capacity and invalid-request failures cannot be retried until the cause is corrected or the workflow is changed.
- A retry must be explicitly requested by the user. It replays only the failed step, preserves previously completed steps, uses the stable `runId:stepIndex` execution key and is bounded to three total attempts.
- A read-only recovery endpoint returns the run status, failed step, error classification, attempts remaining, available manual actions and safe guidance.
- Restart recovery continues to pause in-flight/queued runs at their last durable checkpoint. Users must review and explicitly resume; an interrupted step is not automatically replayed.
- Review checkpoints continue to require an explicit user Continue decision.
- Android's existing on-device task journal continues to mark interrupted work as interrupted and require manual replanning; it does not replay actions after a process restart.

## API contract

- `GET /api/workflow-runs/:id/recovery`: authenticated, no-store, read-only recovery preview.
- `POST /api/workflow-runs/:id/retry`: authenticated manual retry; allowed only for a classified transient failed step and while fewer than three attempts have been made.
- `POST /api/workflow-runs/:id/resume`: authenticated manual resume of a paused workflow run from its durable checkpoint.
- Existing stop, pause, continue, checkpoint and execution routes remain in place.

## Recovery policy

| Failure kind | Classification | Retry |
|---|---|---|
| Timeout | transient | Manual, bounded |
| Network/connectivity | transient | Manual, bounded |
| Provider rate limit | transient | Manual, bounded |
| Temporary provider outage | transient | Manual, bounded |
| Concurrent storage save conflict | transient | Manual, bounded |
| Missing/disabled integration | action required | No; fix configuration |
| Invalid/rejected credential | action required | No; reconnect or rotate credential |
| Permission denied | action required | No; review provider access |
| Missing endpoint | action required | No; fix endpoint configuration |
| Workflow/local capacity limit | action required | No; review capacity |
| Invalid step data or missing handler | action required | No; edit/revalidate/reapprove |
| Unknown error | needs review | No; inspect state first |

The classification is intentionally conservative. A generic/unknown error is not assumed transient. A retry remains a user action, never a timer-driven background action. Stable execution keys and the workflow-step effect ledger protect the local task/memory write handlers against duplicate commits.

## Safety boundaries

- No general auto-repair, self-editing workflow, arbitrary shell/script execution, silent permission escalation or automatic retry loop is introduced.
- A timeout can occur after a provider received a request; the retry is available only as an explicit user decision and the integration actions in this workflow set remain read-only.
- If JARVIS cannot safely identify the failed step, it does not offer a retry.
- A recovery preview does not mutate a run or start/stop execution.
- Recovery summaries do not reveal raw provider replies, bearer tokens, API keys, environment variable values, raw exception messages or stack traces.
- The existing Android local execution journal remains user-controlled and requires manual replan after restart.

## Automated acceptance

The Phase 14 additions cover:
- Stable classification of transient, credential, permission, configuration, endpoint, capacity, invalid and unknown failures.
- Sanitized storage of failure results when an exception contains bearer-like and contact-like strings.
- Recovery previews for transient, non-retryable, paused-after-restart and review-checkpoint states.
- Manual retry allowed only for a transient failure; non-retryable failure is rejected.
- Maximum three attempts and same-step replay/idempotency-key behavior remain enforced.
- Authenticated recovery API, not-found handling, no automatic recovery and blocked retry of configuration failures.
- Existing workflow stopping, pausing, review, checkpoint, restart recovery and Android local journal regressions.

Automated acceptance passed on the PR head `85442feedafaa3f1512bda2e184a02f83881c7bc`: Node CI reported 208/208 tests, 0 failures and 0 production dependency vulnerabilities; Android JVM/unit checks, Gradle build, APK integrity verification and artifact upload all passed in PR run #41438465662. The merged `main` commit has the identical Git tree hash `3d3bcbf07cc1c4e2d76bd21aedcbfdd974f320a2`. Post-merge main run #41438983665 passed the Node job (208/208, 0 vulnerabilities); its duplicate Android job was still shown in progress at closeout, so the completed Android result is referenced from the fully green PR run on the identical source tree. Physical Samsung Galaxy Tab A9 behavior remains to be checked in Phase 31; no hardware acceptance is claimed here.

## Closeout record

- PR: [#53 — merged](https://github.com/18110priyanshuraj-creator/Jarvis/pull/53)
- Merge commit: `11acb4500ea5424f4f51153489bc82b911aba64b`
- Fully green PR CI: [run #41438465662](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41438465662) — both Node and Android jobs passed.
- Post-merge main CI: [run #41438983665](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41438983665) — Node passed (208/208, 0 vulnerabilities); duplicate Android job remained in progress at closeout. Its source tree is identical to the fully green PR source tree above.
- Verified PR debug APK artifact: `13138290782`, 23,973,675 bytes; SHA-256 `44a4b1dfccacfa5a374120f3a9cb4fda56bdb2b03b237bc1a0931805501fe519`.
- Hardware acceptance: Samsung Galaxy Tab A9 hands-on validation remains Phase 31.
