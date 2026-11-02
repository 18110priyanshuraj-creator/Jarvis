# JARVIS Phase 15 — Full Android Task Integration

**Status:** IN_PROGRESS — implementation and regression acceptance are being completed on the Phase 15 feature branch.  
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
- A device-action result is validated on-device and shown in a visible approval dialog. Only the positive Approve and run action may start execution. Cancel, Back and dialog dismissal never start the task.
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

The existing allow-list remains unchanged: open_app, read_screen, tap_label, type_text, scroll_down, scroll_up, back, home, ask_user and finish.

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
- Screen-control plans are blocked when Accessibility is unavailable; app-open-only plans do not require Accessibility.
- Device-action plans cannot run before a visible user approval. Cancel and dismiss remain no-op paths.
- Exactly one execution ID can own the task gate; a non-owner cannot release it.
- Existing protected-control, secret-text, bounded action count, local checkpoint, cancellation, pause/resume, journal and Android build regressions continue passing.

The repository CI is the automated acceptance source for Node syntax/tests/dependency audit, Android unit tests, Gradle debug build, APK integrity verification and artifact upload. Physical Samsung Galaxy Tab A9 interaction remains a separate Phase 31 test; this document does not claim hands-on hardware acceptance.

## Closeout record

- PR: pending
- Merge commit: pending
- PR CI: pending
- Post-merge main CI: pending
- Verified Android artifact: pending
- Hardware validation: Phase 31
