# JARVIS Companion — Phase 1 and Phase 2

This is an additive native Android companion for the existing JARVIS Node.js application. It does not replace the web dashboard or the existing offline brain.

## Phase 1

- Short-lived, single-use device pairing code generated from the authenticated web dashboard.
- Per-device bearer credential, encrypted locally with Android Keystore-backed AES-GCM.
- Server stores only the token hash and supports device revocation.
- Authenticated heartbeat and voice-chat requests.

## Phase 2 Android Control Engine

- User-started microphone foreground service with an ongoing notification and Stop action.
- Hindi (hi-IN) speech recognition; on-device recognition is preferred when Android reports it is available.
- Launch an installed app by its visible launcher name, for example: "Telegram kholo" or "Open YouTube".
- Read a bounded summary of visible screen labels only after the user says "read screen".
- Tap one uniquely matching visible label, scroll an accessible container, navigate Back/Home, and enter dictated text into the already-focused non-sensitive field.
- Screen labels and UI hierarchy stay on the tablet. They are not sent to the server or persisted by this phase.
- Non-action chat transcripts are sent to the existing JARVIS voice endpoint only when the device is paired.

### Voice examples

- "Telegram kholo"
- "Open YouTube"
- "Tap Search"
- "Type JEE Physics"
- "Scroll down"
- "Scroll up"
- "Back"
- "Home"
- "Read screen"
- "Stop listening"

UI labels must be visible and uniquely exposed by the target app's Android accessibility tree. Some apps deliberately expose little or no UI information.

### Explicit safety boundaries

- No automatic Send, Submit, Delete, Remove, Purchase, Payment, Transfer, Confirm, permission-grant or uninstall actions.
- Password, PIN, OTP and verification fields are not read or filled by the engine.
- Numeric strings that could be PINs or one-time codes are not automatically entered.
- Text entry requires the user to focus the field first. The engine never presses Send or Submit after typing.
- No arbitrary screen-coordinate tapping or hidden action chains.
- Screen content is summarized locally only after the spoken "read screen" command; it is not saved or uploaded.
- Stop hands-free listening by saying "stop listening" or pressing Stop in the persistent notification.

## Build

1. Open the android directory in Android Studio.
2. Install Android SDK Platform 36 and use JDK 17.
3. Sync Gradle and build the app debug variant.
4. The GitHub Actions Android job also runs assembleDebug using Gradle 8.13.

The project pins Android Gradle Plugin 8.13.2, Gradle 8.13 and Kotlin Gradle Plugin 2.4.21. The source branch includes Gradle wrapper distribution properties but not the wrapper launcher scripts or JAR; Android Studio or the GitHub Actions job can use the configured Gradle distribution.

## Pairing

1. Deploy the existing JARVIS server to an HTTPS URL.
2. Sign in to the JARVIS web dashboard and open Device Control.
3. Select Generate pairing code. The code expires after 3 minutes and is single-use.
4. Open JARVIS Companion on the tablet.
5. Enter the HTTPS server URL and the six-digit code, then select Pair with JARVIS.
6. The device appears in the dashboard. The server stores only a SHA-256 hash of the device token; the raw token is returned once and protected locally using Android Keystore-backed AES-GCM encryption.

Use the dashboard Revoke button to invalidate a paired device. Removing the credential only from the tablet does not revoke it on the server.

## Enable screen control

1. Open JARVIS Companion.
2. Review the screen-access disclosure.
3. Open Android Accessibility settings and manually enable "JARVIS screen assistant".
4. Return to JARVIS Companion and press Start hands-free control.
5. Grant microphone and notification permissions. Start the service while the app is visible; Android restricts starting microphone foreground services from the background.
6. Open another app and speak one of the supported commands.
7. Stop the session using the ongoing notification or the spoken "stop listening" command.

The AccessibilityService is a powerful permission. Enable it only after reviewing the disclosure, and turn it off from Android settings whenever you do not need it. Android documents AccessibilityService for assisting users with disabilities; distribution through an app store may be subject to additional policy review.

## Voice and privacy

Android's configured speech-recognition provider processes the microphone audio. The app prefers Android's on-device recognition provider when it is available; otherwise the configured system recognition provider may process audio according to its own privacy settings. JARVIS receives recognized text, not raw microphone audio. For general chat, recognized text is sent to the existing JARVIS server over HTTPS.

## Security

- HTTPS is mandatory; cleartext HTTP is rejected.
- The companion never receives the dashboard password or browser session cookie.
- Device access uses a revocable per-device bearer token.
- The server stores only the token hash.
- Pairing codes expire after three minutes and can be used once.
- Consequential actions and sensitive fields remain manual.
