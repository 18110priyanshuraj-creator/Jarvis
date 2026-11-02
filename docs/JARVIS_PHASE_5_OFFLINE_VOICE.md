# JARVIS Phase 5 — Offline Voice System

**Status:** CODE_COMPLETE — offline-selection policy, native integration, privacy-mode UI and automated tests are implemented. Actual Samsung Galaxy Tab A9 language-pack, microphone and TTS behavior remains Phase 31.
**Target:** Existing application ID `com.priyanshuraj.jarviscompanion`
**Baseline:** Phase 4 local system controller on `main`

## Objective

Make speech recognition and spoken replies offline-first, expose an explicit offline-only option, and never describe a system-provider fallback as guaranteed offline.

## Implemented

- Persist a voice privacy mode in the existing `jarvis_companion_settings` preferences: `Prefer offline` (default) and `Offline only`.
- Route one-shot speech and hands-free speech through the same testable recognition policy.
- On Android 12 / API 31 and newer, select `SpeechRecognizer.createOnDeviceSpeechRecognizer` when Android reports on-device recognition support.
- In `Offline only`, refuse to start if the on-device recognizer is unavailable; never start the ordinary system recognizer or silently fall back online.
- In `Prefer offline`, use the on-device recognizer when available. Otherwise use Android's system recognizer with the offline preference hint, and clearly disclose that the provider may need internet.
- Keep language fallback within the selected recognizer; an unavailable Hindi offline language may retry English (India), but never changes the recognizer privacy mode.
- Make text-to-speech honor the same privacy preference. Offline-only output selects installed non-network voices only and reports when no matching local voice is installed.
- Add the voice privacy selector to the existing setup screen and include current mode / recognizer capability in the permission checklist.
- Keep microphone permission, explicit user-initiated sessions, foreground notification, Stop/Interrupt, and existing server command routing intact.

## Privacy and capability boundary

- Offline-only applies to speech recognition and text-to-speech. It does not make the entire assistant or paired server AI offline: an unhandled conversational request may still be sent to the configured JARVIS server, as before.
- Android's installed on-device recognizer and language models must be present. A runtime availability check cannot guarantee that every language model is downloaded; the actual language is validated when recognition starts.
- Offline-only text-to-speech requires an installed local voice for the reply language. If missing, JARVIS does not silently use a network voice.
- In Prefer offline mode, Android system speech recognition / TTS providers may use the network when local capabilities are not available.
- No transcripts or audio recordings are added to the execution ledger or written to the server by the voice policy.

## Automated acceptance

- Policy tests cover on-device selection, unsupported Android/API cases, strict offline refusal, system-provider disclosure, missing speech service and invalid saved preference.
- Node tests and production dependency audit remain green.
- Android unit tests, Room persistence tests, debug APK build and APK archive verification pass on the final commit.

## Completion boundary

Phase 5 is code-complete only after full CI and APK verification pass. Physical checks of Hindi/English offline model availability, microphone capture, TTS voice downloads, audio quality and background-service behavior on the Galaxy Tab A9 are reserved for Phase 31 and are not claimed by automated CI.
