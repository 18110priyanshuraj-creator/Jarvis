# Phase 21 — Interruptible Android Task Execution

## Goal

Make Android multi-step voice actions stoppable and prevent stale work from continuing after the user interrupts, ends the session, starts a newer request, or leaves the app.

## Cancellable action sequence

- Device plans are executed as an ordered sequence of one to six allow-listed actions.
- The sequence scheduler exposes cancellation and removes the queued continuation from the Android main-thread Handler.
- A cancelled sequence never calls its completion callback and never schedules its remaining steps.
- A failed action and an explicit `ask_user` / `finish` checkpoint stop the sequence immediately.
- Delay values between actions are bounded to three seconds.

## Voice-session lifecycle

- The notification action is now labelled **Interrupt / cancel task**. It invalidates the current turn, cancels the queued action sequence, stops current speech and returns the running session to listening.
- **Stop** invalidates the current turn, cancels queued actions and speech recognition, removes the foreground notification and ends the service.
- A new recognized voice turn invalidates any older queued plan before its work begins.
- Service destruction and task removal invalidate all outstanding work.
- Responses that arrive after their originating turn was invalidated are ignored. This prevents a late planner response from starting a device-action plan and prevents a late chat reply from being spoken over a newer turn.

## Important limits

Cancellation is forward-looking. It cannot undo a UI action that Android already completed before the cancellation was processed. The server request itself is not forcibly aborted; a late response is discarded on the Android main thread and cannot launch more actions. No rollback or undo capability is claimed.

The sequence still uses the Phase 20 allow-list and Android-side protected-control checks. This phase does not add shell access, unrestricted app control, hidden microphone use, automatic message sending, payments, deletion, password or verification-code entry.

## Verification

JVM unit tests cover:

- Normal sequential execution and exactly one completion callback.
- Cancellation after one step has run but before the next queued step.
- Cancellation before the first step is dispatched.
- An explicit user checkpoint stopping later actions.
- A failed action preventing subsequent actions.

Android CI now runs `testDebugUnitTest` before `assembleDebug`, then verifies and uploads the APK. Physical interruption and UI-action timing still require a final test on the target Android tablet.
