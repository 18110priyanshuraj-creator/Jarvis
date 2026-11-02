# JARVIS Phase 3 — Native Android Core

**Status:** IN PROGRESS — native runtime foundation and local execution journal
**Target:** Existing Android application ID `com.priyanshuraj.jarviscompanion`
**Baseline:** Phase 2 code-complete application shell on `main`

## Objective

Establish one Android-owned runtime shared by the launcher Activity and microphone foreground Service. Typed home input and one-shot voice input use the same local-first command dispatcher; hands-free local actions and bounded remote planner/reply calls cross the same runtime boundary.

## Implemented scope

- Add an Application-scoped `NativeCoreRuntime`, lazily initialized once per process and shared by Activity and Service.
- Route typed requests and one-shot speech through one dispatcher: bounded validation, local command handling first, then an optional paired-server reply.
- Keep hands-free accessibility actions behind the existing explicit microphone/accessibility permissions and safety checks.
- Route pairing, heartbeat, agent-plan and assistant-reply network calls through the native core gateway; preserve the existing HTTPS connector and Keystore device token.
- Add Room database version 1 with a bounded 500-record execution journal.
- Persist only source, route, outcome, input character count, duration and timestamp. Do not persist transcripts, prompts, screen content, URLs or credentials.
- Add JVM tests for local-first routing, remote gating, input bounds and journal metadata, plus Robolectric persistence/retention tests for Room.

## Data and migration boundary

- The database is additive and starts empty. It does not import or overwrite SharedPreferences, the existing activity log, the device-token store, Render JSON state or Neon data.
- The device token remains in Android Keystore-backed encrypted preferences.
- The remote browser dashboard and Neon/JSON persistence remain unchanged.
- No destructive Room migration fallback is enabled. Future schema changes must add a versioned Room migration and persistence test.
- The execution journal is diagnostic metadata, not chat history, memory or task storage.

## Acceptance checks

- `testDebugUnitTest` passes dispatcher and privacy-policy tests.
- Robolectric verifies Room write/read across a database reopen and bounded retention.
- Node.js tests and production dependency audit stay green.
- Android debug APK compiles, verifies as a ZIP and uploads as the CI artifact.
- Existing orb, Setup/pairing, WebView, voice and accessibility paths remain connected.
- No production data migration or server source-of-truth cutover occurs in this phase.

## Completion boundary

Phase 3 is code-complete only after the complete Node and Android CI workflow passes on the final commit and Render remains live on the same `main` commit. Real Samsung Galaxy Tab A9 installation, OS process-death behavior, physical microphone and accessibility interactions remain Phase 31 acceptance items.
