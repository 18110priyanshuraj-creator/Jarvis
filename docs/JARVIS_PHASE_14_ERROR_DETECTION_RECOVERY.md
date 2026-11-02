# JARVIS Phase 14 — Error Detection and Recovery

**Status:** IN_PROGRESS — implementation and automated acceptance are being completed on the Phase 14 feature branch.  
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

The repository CI workflow is the acceptance source for Node syntax/tests/dependency audit and Android unit/build/APK verification. Physical Galaxy Tab A9 behavior remains to be checked in Phase 31; no hardware acceptance is claimed here.

## Closeout record

- PR: pending
- Merge commit: pending
- Main CI run: pending
- Final artifact: pending
