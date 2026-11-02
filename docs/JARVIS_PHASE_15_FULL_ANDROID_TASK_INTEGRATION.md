# JARVIS Phase 15 — Full Android Task Integration

**Status:** VERIFIED for repository/automated acceptance — original integration PR #54 and outcome-verification PR #55 are merged. Physical Samsung Galaxy Tab A9 acceptance remains Phase 31.  
**Branch:** feat/phase-15-full-android-task-integration  
**Base:** 4073a0f466ec449816f07b84e302bbf8df7d0360

## Goal

Make typed Orb input, one-shot voice and hands-free voice use one authenticated task-planning contract, the same on-device action validator, and the same bounded Android execution and journaling engine.

## Existing architecture retained

- The Node.js service remains the authenticated planner and request-mode router. Android uses its already-paired HTTPS device credential; no dashboard password, browser cookie or AI provider key is moved into the APK.
- Local Android commands and encrypted local memories remain device-local.
- Server-side request modes remain conversation, clarification and device action. Conversation and clarification plans cannot carry device actions.
- The Android action allow-list and shared UiActionPolicy remain authoritative. Server-side model output is always untrusted and is never executed without local validation and approval.
- The hands-free foreground service keeps its existing user-started microphone session, spoken preview/approval, spoken pause/resume/cancel and notification Stop/Interrupt controls.

## Scope added in Phase 15

- NativeCoreRuntime.requestAgentPlan accepts the originating CoreCommandSource, so typed Orb and one-shot voice planning are attributed correctly in the privacy-minimized execution ledger instead of being recorded as hands-free input.
- MainActivity routes typed Orb and one-shot voice input through a local-first background executor. Room-backed local memory and command processing are not run on the Android UI thread.
- If a local command handles the request, no planner or remote call is made. Otherwise, a paired device requests the planner's conversation, clarification or device-action result.
- Orb and one-shot voice device-action results are validated on-device and shown in a visible approval dialog. Only the positive Approve and run action may start execution; Cancel, Back and dialog dismissal never start the task. Hands-free voice retains its spoken plan preview and explicit approve plan or cancel plan decision.
- The approval preview describes each proposed action, shows typed search or draft text, and explicitly states that consequential actions remain manual.
- Conversation and clarification responses display normally and do not enter the device-action runner. Invalid mode/action combinations fail closed to the existing chat fallback; they do not execute actions.
- AgentPlanRunner.mode centralizes on-device validation for all three modes. The runner rejects conversation/clarification results containing actions and accepts only the known bounded action categories for device execution.
- AgentPlanRunner.executionBlockReason detects plans that require visible UI/accessibility operations. When the Accessibility service is unavailable, those plans are blocked before the first action, and the UI may open Android Accessibility Settings only after a separate user tap.
- A synchronized process-wide AgentPlanExecutionGate serializes all task execution paths. A plan must own the gate before its first action; only the owning execution ID can release it.
- Orb tasks expose on-screen Pause, Resume and Cancel controls. Cancel has a confirmation dialog. Activity destruction cancels an Activity-owned sequence so it cannot continue after its owner is destroyed.
- The existing hands-free path calls the shared mode validator and checks the shared execution gate before beginning another request. It retains its spoken approval and task controls.
- The shared task runner continues using CancellableActionSequence and LocalTaskExecutionJournal. Progress stores only generic action types, step states and timestamps. It never journals the transcript, app labels, search terms, text entry or screen text.
- A task that cannot save its initial durable checkpoint does not return stale controls or start actions. A second task cannot overlap the currently active sequence.

## Request lifecycle

1. Typed Orb, Speak once or hands-free input starts a user-requested turn.
2. Local Android commands are checked off the UI thread.
3. Unhandled requests go to the authenticated HTTPS planner.
4. The on-device mode validator accepts conversation, clarification or device action. Conversation/clarification results with device actions are rejected.
5. A device-action plan is checked against the allow-list and Accessibility preflight.
6. The plan is previewed on screen (Orb/one-shot) or spoken (hands-free).
7. No action runs until the user explicitly approves that plan.
8. The task runner acquires the single-task gate, runs bounded steps and writes generic local checkpoints.
9. The user can pause, resume or cancel. Completion or cancellation releases the task gate.

## Supported action boundary

The bounded allow-list is extended with read-only `verify_app_foreground` and `verify_screen_text` checks. Other supported actions remain open_app, read_screen, tap_label, type_text, scroll_down, scroll_up, back, home, ask_user and finish.

The engine does not add arbitrary gestures, coordinate taps, shell/code execution, sending/submitting messages, deleting data, purchasing, payments, transfers, security/account changes, credential/OTP entry, permission grants, app installation or automatic selection of search results. Sensitive actions must remain manual.

## Privacy and lifecycle

- Recognized speech and typed request text are sent only to the paired server when planning/chat needs the server. Android does not upload raw microphone audio in this flow.
- The task journal contains no transcript, query, app name/label, entered text or screen text. It keeps only generic action categories, statuses and timestamps.
- Screen hierarchy remains local; the server planner receives the request text only.
- Accessibility is user-enabled in Android Settings and is never granted by JARVIS.
- Hands-free microphone use remains explicitly user-started; no wake-word, hidden always-on recording, background listening or voice activity detector is introduced.
- On restart, the existing journal marks unfinished work interrupted and requires manual replan. This phase does not replay device actions after a process restart.

## Automated acceptance targets

- Typed and one-shot commands use the background local-first/planner path and pass the correct source into the execution ledger.
- Hands-free and Orb requests use the same on-device mode/action validator and execution gate.
- Conversation/clarification modes containing hidden actions are rejected.
- Screen-control and verification plans are blocked when Accessibility is unavailable; app launches that require foreground verification also require the user-enabled Accessibility service.
- Device-action plans cannot run before a visible user approval. Cancel and dismiss remain no-op paths.
- Exactly one execution ID can own the task gate; a non-owner cannot release it.
- Existing protected-control, secret-text, bounded action count, local checkpoint, cancellation, pause/resume, journal and Android build regressions continue passing.

The repository CI is the automated acceptance source for Node syntax/tests/dependency audit, Android unit tests, Gradle debug build, APK integrity verification and artifact upload. Physical Samsung Galaxy Tab A9 interaction remains a separate Phase 31 test; this document does not claim hands-on hardware acceptance.

## Closeout record

- PR: [#54 — merged](https://github.com/18110priyanshuraj-creator/Jarvis/pull/54)
- Merge commit: e6773b7a243351cebfda8c64925f1f9ab2118c72
- Fully green PR CI: [run #41444466583](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41444466583) — Node and Android jobs passed.
- Post-merge main CI: [run #41445057821](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41445057821) — Node 208/208, 0 failures, 0 production vulnerabilities; Android testDebugUnitTest, assembleDebug, APK verification and upload passed.
- Verified main debug APK artifact: 13142356532, 23,971,126 bytes; SHA-256 9b1087cf894ebce2d2b830ad65127034a2e4e2e0dd8fd5872c5f1c2533f3d123.
- Hardware validation: physical Samsung Galaxy Tab A9 acceptance remains Phase 31.

## Phase 15 verification hardening — PR #55

**Branch:** `fix/phase15-outcome-verification`  
**Pull request:** [#55 — verify Phase 15 task outcomes before completion](https://github.com/18110priyanshuraj-creator/Jarvis/pull/55)  
**Review status:** CI and merge are tracked separately; this section must not be read as physical-device acceptance.

### Gap addressed

The original action executor treated Android returning `true` from an accessibility action as a successful operation. That indicates that Android accepted the request; it does not demonstrate that the expected app or visible result appeared. This follow-up adds explicit postconditions and makes the planner and Android validator independently require them.

### Implementation

- `UIActionExecutor.verifyVisibleText` compares a short expected phrase with the currently exposed accessibility labels. It reads the tree on-device, in memory, skips password-node values, refuses protected screens and does not persist or upload the screen contents.
- `LocalCommandProcessor.verifyAppForeground` compares the active accessibility window's package identity with the unique installed launcher-app label requested by the plan.
- Every `open_app` action must be followed immediately by `verify_app_foreground` for the same normalized app label.
- Every tap/type/scroll/Back/Home mutation must have a later `verify_screen_text` action before a plan can finish.
- Server-side `services/agent-planner.js` and native `AgentPlanRunner` independently enforce those structural requirements.
- A missing or mismatched verification stops execution at the user-review boundary; later actions are not run and the task is not reported as completed.
- The local app-search template enters a query and verifies that it is visible, then pauses. Search submission and result selection remain manual because the current safe allow-list does not include submit or automatic result selection.
- The local journal records only generic `verify app` and `verify screen` categories. It does not store expected phrases or screen text.

### New regression coverage

- Server tests reject app launches without a matching foreground check and UI mutations without a visible-result check.
- Device API test expects the six-step verified search plan.
- Android validator tests reject missing/mismatched app checks and missing UI-result checks.
- UI policy tests cover normalized phrase matching.
- Journal tests ensure verification steps remain generic and do not leak entered text.

### Verification boundaries

Visible phrase matching proves only that the expected phrase is exposed in the current accessibility tree. It does not prove that a web page is factually correct or that a complex external task has succeeded. A protected or inaccessible screen must pause for user review. Physical Samsung Galaxy Tab A9 execution remains Phase 31 and is not claimed here.

### Follow-up acceptance checklist

- [x] Foreground identity check implemented locally.
- [x] Visible-text postcondition check implemented locally.
- [x] Server and Android validators require corresponding checks.
- [x] Generic privacy-minimized journal categories added.
- [x] Node and Android regression tests updated.
- [x] PR #55 Node CI and production dependency audit green (209 tests, 0 failures, 0 production vulnerabilities).
- [x] PR #55 Android unit tests/build/APK verification green.
- [x] PR #55 merged to main and resulting main SHA checked (`8b00096ea7b62611d5275656a292d5db78c07a72`).
- [ ] Physical Galaxy Tab A9 test (reserved for Phase 31).

### Final outcome-verification closeout

- PR: [#55 — merged](https://github.com/18110priyanshuraj-creator/Jarvis/pull/55).
- Squash merge / final main commit: `8b00096ea7b62611d5275656a292d5db78c07a72`.
- PR CI: [run #41451937432](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41451937432) — Node 209/209, 0 failures, 0 production vulnerabilities; Android `testDebugUnitTest`, `assembleDebug`, APK integrity verification and upload passed.
- Post-merge main CI: [run #41452457643](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41452457643) — Node 209/209, 0 failures, 0 production vulnerabilities; Android `testDebugUnitTest`, `assembleDebug`, APK integrity verification and upload passed on the merged main SHA.
- Main debug APK artifact: `jarvis-companion-debug`, artifact ID `13145531007`, SHA-256 `cad0a836115098ac0ae6f1763647601e83bea9c4bc8bf34ca08f6305141b2501`, APK size 47,999,101 bytes, expires 2026-11-09.
- Physical Galaxy Tab A9 acceptance is not inferred from CI and remains open under Phase 31.
