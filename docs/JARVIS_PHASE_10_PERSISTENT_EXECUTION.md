# Phase 10 — Persistent Execution Engine

**Status:** IN_PROGRESS — implementation is on the Phase 10 feature branch; the final GitHub Actions Node and Android jobs are pending.  
**Scope:** Persistent server workflows plus bounded native Android action-sequence progress.  
**Branch:** `feat/phase-10-persistent-execution`

## Purpose

Keep multi-step JARVIS work observable and recoverable across pauses, cancellations, application restarts and runtime failures. A dispatched action is not treated as successful until the handler has returned and the result has been durably checkpointed.

## Existing code retained

- `services/workflow-engine.js` remains the workflow lifecycle and step runner.
- `server.js` continues using the existing JSON/Neon canonical application state store.
- Existing workflow approval and review checkpoints remain mandatory.
- `public/app.js` extends the existing Workflows screen; it does not add a second dashboard.
- `AgentPlanRunner` and `CancellableActionSequence` remain the bounded native Android operator path.
- Existing task, memory, integration, screen-observation and device permission policies are unchanged.

## Implemented architecture

### Server workflow checkpoints

Each workflow step now has a stable execution key of `<run-id>:<step-index>`. Before invoking the handler, JARVIS persists the current step as running. After a handler returns, JARVIS persists its result, next-step index, log event and run state before advancing to the next step.

The `workflowStepEffects` ledger is stored in the same canonical application state as local tasks and memories and is included in user data exports. The `create_task` and `save_memory` handlers persist their local effect and its replay record together. If the process restarts after that commit but before the step-completed checkpoint, the same execution key returns the prior result instead of repeating the local write. Read-only integration steps remain allow-listed.

The existing synchronous API behavior remains available for compatibility. The Workflows UI opts into asynchronous execution through `Prefer: respond-async`. Those requests are persisted as queued runs and drained by one worker at a time. A queued run can be paused or cancelled before it starts. While a worker is executing a step, safe pause/stop requests are honored at the next checkpoint. Legacy callers that omit the preference header retain the synchronous response behavior.

### Restart recovery

On server startup, a workflow run left in `queued` or `running` is changed to `paused`. Its last running step is returned to pending at the same index; already completed steps remain completed. Recovery metadata records the restart reason and the requirement for manual resume. JARVIS never silently replays an in-flight action during startup.

The workflow must be resumed explicitly through the authenticated resume route. Stable execution keys protect local write steps if their effect was committed immediately before the restart. A handler that exceeds its timeout is marked failed; JavaScript cannot forcibly terminate an already-running handler, so currently enabled remote handlers are read-only and local write handlers are idempotent.

### Pause, resume, stop and retry

- Async UI runs are queued and processed by a single worker, avoiding overlapping workflow execution.
- Pause requests are honored at the next safe step boundary; queued runs can be paused before execution.
- Resume starts from the durable next-step index.
- Stop requests do not start later steps; a currently executing step is allowed to reach its next safe boundary.
- Each server workflow step has a 60-second default timeout (internally configurable within 100 ms–120 seconds). A timeout fails the current step and prevents later steps from starting.
- Failed steps can be manually retried without restarting completed steps.
- Attempts are bounded to three per step. The workflow history retains failure/retry log entries.
- Concurrent duplicate starts and duplicate run controls are rejected.

### Android Companion progress

The native action sequence now emits step progress, supports in-process pause/resume/cancel, and reports explicit terminal states. The app-private task journal records only generic action categories, step states, indexes and timestamps. It does not store transcripts, app names, screen text, typed content, URLs or credentials.

On Android process restart, a task previously marked running or paused becomes `interrupted`. It is not automatically replayed. Because the original action payload is intentionally not persisted, the user must review and reissue the task. This is a deliberate safety boundary; exact automatic continuation of arbitrary third-party app UI actions is not claimed.

Voice control understands the explicit phrases “pause task”, “resume task” and “cancel task” while a bounded native plan is active.

## API changes

| Route | Purpose |
|---|---|
| `POST /api/workflows/:id/run` | Starts an approved workflow. Existing synchronous mode is preserved; `Prefer: respond-async` returns a running checkpoint. |
| `POST /api/workflow-runs/:id/continue` | Continues after an explicit review checkpoint. |
| `POST /api/workflow-runs/:id/pause` | Requests pause at the next safe boundary. |
| `POST /api/workflow-runs/:id/resume` | Resumes a paused or restart-recovered run. |
| `POST /api/workflow-runs/:id/retry` | Retries only the identified failed step, up to the three-attempt limit. |
| `POST /api/workflow-runs/:id/stop` | Stops at a safe boundary or cancels a paused/review-waiting run. |

All endpoints remain behind the existing authenticated API middleware.

## Privacy and safety

- No arbitrary shell execution or generated code execution was added.
- Existing allow-listed workflow step types remain the only runnable server step types.
- Public publishing, external messages, payments and destructive actions are not introduced.
- Local server writes use stable idempotency keys and a replay ledger.
- Android action plans are not persisted in plaintext.
- Interrupted Android UI actions are not replayed automatically.
- Pause and stop operate at safe checkpoints rather than interrupting an action halfway through a platform API call.

## Implementation checklist

| Item | Status |
|---|---|
| Durable pre-action and post-action server checkpoints | IMPLEMENTED — CI pending |
| Stable per-step execution keys | IMPLEMENTED — CI pending |
| Idempotent local task and memory writes | IMPLEMENTED — CI pending |
| Persist workflow run and execution log | IMPLEMENTED — existing canonical state store |
| Recover active server runs as paused after restart | IMPLEMENTED — CI pending |
| Explicit workflow resume | IMPLEMENTED — CI pending |
| Pause and stop at safe step boundaries | IMPLEMENTED — CI pending |
| Per-step timeout and timeout failure handling | IMPLEMENTED — 60-second default; later steps remain unstarted |
| Bounded manual retry of failed step | IMPLEMENTED — max three attempts |
| Existing Workflows UI progress and controls | IMPLEMENTED — CI pending |
| Native Android action-sequence progress journal | IMPLEMENTED — CI pending |
| Native Android in-process pause/resume/cancel | IMPLEMENTED — CI pending |
| Android restart recovery without automatic replay | IMPLEMENTED — CI pending |
| Node unit/integration tests | PENDING FINAL CI |
| Android JVM/Robolectric tests and APK build | PENDING FINAL CI |
| Physical Samsung Galaxy Tab A9 validation | NOT_APPLICABLE_TO_PHASE_10 — Phase 31 gate |

## Verification plan

The GitHub Actions workflow `.github/workflows/check.yml` is the verification gate:

1. `npm run check` — syntax checks and full Node test suite.
2. `npm audit --omit=dev --audit-level=high` — production dependency audit.
3. `gradle -p android --no-daemon --stacktrace testDebugUnitTest assembleDebug` — Android tests and APK build.
4. APK existence and ZIP integrity verification, SHA-256 generation and artifact upload.

New focused tests cover per-step checkpoints, pause/resume, queued-run pause, restart recovery, safe stop, timeout handling, bounded retry, Android sequence callbacks, Android journal recovery, generic-only persisted data and bounded local history.

## Known limits

- The native Android journal records progress metadata but deliberately does not save the full UI action payload. After an Android process death, the task is interrupted and requires user review/replanning.
- A persisted server workflow can resume only the allow-listed server workflow step types. It is not yet a universal Android browser/app automation runtime.
- Actual Galaxy Tab A9 behavior, app lifecycle and performance remain a Phase 31 real-device requirement.
- A GitHub Actions debug APK build does not constitute a physical installation test.

## Completion result

**Not yet verified.** Do not mark Phase 10 complete until the final CI run passes both jobs and the branch diff is reviewed. Physical device acceptance remains Phase 31.
