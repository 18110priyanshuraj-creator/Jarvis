# JARVIS Companion — Phase 1

This is an additive native Android companion for the existing JARVIS Node.js application. It does not replace or modify the web dashboard architecture.

## Phase 1 scope

- Pair an Android device with a short-lived, one-time code generated in the authenticated JARVIS dashboard.
- Store the device bearer credential encrypted with an AES-GCM key backed by Android Keystore.
- Send authenticated heartbeat updates.
- Capture a user-initiated Hindi speech transcript with Android SpeechRecognizer.
- Send voice transcripts to the existing offline JARVIS brain and read the response with Android TextToSpeech.
- Optionally observe foreground app package changes through an AccessibilityService.

The Phase 1 accessibility service records only the foreground package name, accessibility event type and timestamp. It does not read window text, inspect message contents, click controls, type text, launch apps or automate screens. Full Android UI actions are a later phase and must be explicitly approved.

## Build

1. Open the android directory in Android Studio.
2. Install Android SDK Platform 36 and use JDK 17.
3. Sync the Gradle project.
4. Build the app debug variant and install it on the tablet.

The project pins Android Gradle Plugin 8.13.2, Gradle 8.13 and Kotlin Gradle Plugin 2.4.21. This source branch includes the Gradle wrapper distribution properties but does not include the wrapper launcher scripts or wrapper JAR. For command-line builds, install Gradle 8.13 and run the Gradle wrapper task from the android directory to generate the standard wrapper files; alternatively, configure Android Studio to use a local Gradle 8.13 installation.

## Pairing

1. Deploy the existing JARVIS server to an HTTPS URL.
2. Sign in to the JARVIS web dashboard and open Device Control.
3. Select Generate pairing code. The code expires after 3 minutes and is single-use.
4. Open JARVIS Companion on the tablet.
5. Enter the HTTPS server URL and the six-digit code, then select Pair with JARVIS.
6. The device appears in the dashboard. The server stores only a SHA-256 hash of the device token; the raw token is returned once and protected locally using Android Keystore-backed AES-GCM encryption.

Use the dashboard Revoke button to invalidate a paired device. Removing the credential only from the tablet does not revoke it on the server.

## Voice

Tap Speak to JARVIS and speak a Hindi command. Android's configured speech-recognition provider processes the recording; provider availability and privacy behaviour depend on the device's Android configuration. JARVIS then receives only the recognized text over HTTPS. In this phase, responses come from the existing built-in offline rules, not a hosted LLM.

## Accessibility

Accessibility is optional in Phase 1. Use the settings button to open Android Accessibility settings and enable the clearly named JARVIS app-change observer only after reviewing its description. The service does not inspect screen contents or execute actions yet.

## Security notes

- HTTPS is mandatory; cleartext HTTP is rejected.
- The companion never receives the dashboard password or browser session cookie.
- Device access uses a revocable per-device bearer token.
- The server stores only the token hash.
- Do not share pairing codes; they expire quickly and can only be used once.
- Sensitive actions, payment flows, passwords and OTPs are not automated by this Phase 1 build.
