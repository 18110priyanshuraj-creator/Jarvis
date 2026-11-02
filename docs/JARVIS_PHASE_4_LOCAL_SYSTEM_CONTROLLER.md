# JARVIS Phase 4 — Local System Controller

**Status:** CODE_COMPLETE — local command integration and Android controller tests passed in CI; physical Samsung Galaxy Tab A9 acceptance remains in Phase 31.
**Target:** Existing application ID `com.priyanshuraj.jarviscompanion`
**Baseline:** Phase 3 application-scoped native runtime on `main`

## Objective

Provide one local, permission-aware Android system-control boundary. Typed home commands, one-shot speech and the explicitly started hands-free session must reach the same deterministic local controller before any optional remote assistant request.

## Implemented

- Add `LocalSystemController` and a single `LocalSystemPlatform` boundary shared by the app-scoped `NativeCoreRuntime`.
- Route local system commands before the existing installed-app launcher and before the optional paired-server assistant. Unknown phrases continue to the existing handler; no network request is introduced for a supported local control.
- Read a bounded device snapshot: battery percentage/charging state, active network transport/connectivity state and media-volume percentage.
- Support local media-volume increase/decrease, mute/unmute and an explicit 0–100% setting through Android `AudioManager`.
- Open Android-owned settings pages for Wi-Fi, wireless/mobile network, Bluetooth, display, sound, battery saver, location, airplane mode, accessibility, hotspot, JARVIS app permissions, notifications and general settings.
- Recognize English, Hindi and Hinglish command patterns for status, volume and settings navigation.
- Add the `ACCESS_NETWORK_STATE` manifest permission; do not request location, contacts, storage, SMS or broad package visibility.
- Bump the Android build metadata to version code 4 / `0.4.0-phase4`.

## Safety and privacy boundaries

- Wi-Fi, Bluetooth, mobile data, hotspot, location and airplane-mode commands open the relevant Android Settings page. The user performs the actual switch; the app does not bypass Android's system restrictions or silently alter connectivity/location.
- Volume controls are restricted to the media stream and display Android's native volume UI. Ring, alarm and call volumes are not changed.
- The status view reports only battery/charging, coarse network transport state and media-volume percentage. It does not collect GPS, Wi-Fi names, nearby devices or app contents.
- Unsupported or ambiguous commands remain unhandled and can follow the existing local/remote routing rules. The system controller does not upload device status.
- Existing accessibility protections, manual plan approval, foreground-service notification, Keystore token and Room execution-journal privacy limits remain unchanged.

## Automated acceptance

- English, Hindi and Hinglish status, volume and settings phrases map to the expected deterministic command.
- A fake platform verifies each local operation crosses the single controller boundary.
- Radio/location/airplane toggle requests are verified to open Settings only and return an explicit manual-change message.
- Invalid volume ranges and unsupported/ambiguous commands do not invoke a platform action.
- Node tests, Android unit tests, Room persistence tests, APK build and APK archive verification all pass on the final commit.
- Render remains live on the same `main` commit; no backend, Neon, JSON, dashboard or device-token state is migrated.

## Completion boundary

This is code-complete only after the final Node and Android CI jobs pass and the existing Render service remains healthy on the same commit. Physical tablet checks (volume steps, sound output, settings destinations, network-state accuracy, speech recognition and Accessibility behavior on One UI) belong to Phase 31 and are not claimed by CI.
