# Phase 20 — Android Device Control

## Goal

Make a small, useful set of Android voice-control workflows available even when the optional server AI planner is not configured. Keep actions explicit, bounded, visible to the user and executed on the paired Android device.

## Built-in request planning without external AI

The server's device-plan endpoint now uses a deterministic rules parser before reporting that the remote AI planner is unavailable. This avoids an external AI provider for the supported patterns; it is not fully offline phone control. It only builds a plan for clear app-search phrases:

- `Open YouTube and search for JEE Physics`
- `YouTube kholo aur JEE Physics search karo`
- `YouTube par mole concept search karo`
- `Search for circular motion on YouTube`

The workflow is intentionally limited to four steps:

1. Open the named installed app.
2. Tap the exact visible `Search` label.
3. Enter the supplied ordinary search phrase.
4. Stop and ask the user to choose a result manually.

The planner does not inspect the screen on the server, guess a result, submit a form, or continue past the user-choice checkpoint. The Android Companion performs accessibility actions locally.

## Existing local controls

During an explicitly started voice session, the Android Companion continues to support app launch, on-device screen summaries, scrolling, Back, Home, exact-label taps and ordinary text entry into a field the user has already focused.

The direct commands already recognized by the Android Companion can work without pairing. The deterministic multi-step planner uses the authenticated paired-device route, but does not require a remote AI key for the supported fixed patterns.

## Safety and privacy boundaries

- Android Accessibility remains opt-in and must be enabled manually by the user in Android Settings.
- Microphone use remains limited to a session the user explicitly starts. A persistent Android notification exposes Stop and Interrupt speech.
- Screen summaries are processed on the device and are not sent to the server.
- The existing local executor and server validator continue to reject sensitive numeric codes and protected controls such as send, submit, delete, payment, purchase, transfer, passwords, PINs, OTPs, verification, account-security and permission controls.
- A conservative filter declines a small set of high-risk search terms. Pattern filtering is a safeguard, not a complete safety classifier.
- Search results are not automatically opened. The user selects the result.
- Unsupported or ambiguous requests are not guessed. Broad natural-language device planning still requires the separately configured server AI provider.

## API behavior

- `POST /api/devices/plan` returns `externalAI: false` and `engine: built-in-device-rules` for a supported deterministic app-search request.
- A request outside the built-in patterns returns the existing `AI_NOT_CONFIGURED` response when the server AI planner is disabled.
- When remote AI planning is enabled, the existing validated AI-plan path remains available and responses are marked `externalAI: true`.

## Verification

Tests cover English, Hindi and Hinglish app-search phrasing, reversed search phrasing, bounded action order, manual result selection, unsupported requests, selected restricted/high-risk search terms, authenticated paired-device planning and the distinction between local and remote planning.

The repository CI remains responsible for running the Node.js test suite, dependency audit and Android Companion build. Physical testing is still needed on the target tablet to confirm installed app labels, accessibility node labels, Android speech recognition and the device's TTS voice.
