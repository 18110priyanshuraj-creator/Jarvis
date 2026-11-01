# JARVIS Companion — Phases 1–4

This is an additive native Android companion for the existing JARVIS Node.js application. It does not replace the web dashboard or the existing offline brain.

## Phase 1

- Short-lived, single-use device pairing code generated from the authenticated web dashboard.
- Per-device bearer credential, encrypted locally with Android Keystore-backed AES-GCM.
- Server stores only the token hash and supports device revocation.
- Authenticated heartbeat and voice-chat requests.

## Phase 2 Android Control Engine and Phase 3 AI Planner

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
4. The GitHub Actions Android job also runs assembleDebug using Gradle 8.14.6.

The project pins Android Gradle Plugin 8.13.2, Gradle 8.14.6 and Kotlin Gradle Plugin 2.4.21. The source branch includes Gradle wrapper distribution properties but not the wrapper launcher scripts or JAR; Android Studio or the GitHub Actions job can use the configured Gradle distribution.

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


## Current provider-independent AI routing

The JARVIS server uses its provider-independent AI adapter. The Android Companion does not contain an AI provider key and does not require Gemini. When the server has a compatible provider configured, the Companion sends the recognized transcript over HTTPS to the paired JARVIS server. The server chooses conversation, an allow-listed device-action plan, or clarification. The Android app validates device actions again before local execution. When no AI provider is configured, the server can use its built-in offline rules; that offline brain is not represented as a general-purpose model.

### Permission checklist

The app distinguishes required permissions from optional or unnecessary access:

- Microphone: required for voice recognition.
- Accessibility: required for reading visible accessibility labels and performing supported screen actions. The user must enable it manually in Android Settings.
- Notifications: recommended so the hands-free session's Stop and Interrupt speech actions are accessible.
- Server pairing: required for remote AI conversation and server-side planning; basic local app launching does not need pairing.
- Storage and Downloads: not needed by the current Companion.
- Display over other apps: not needed; the Companion does not use a floating overlay.
- Install unknown apps: controlled by the source app (such as the browser or file manager) used to open a manually downloaded APK. JARVIS itself does not request package-install permission.

Android system permission dialogs and protected settings cannot be silently accepted by JARVIS. The checklist opens the relevant Settings page and asks the user to grant access themselves. Do not enable permissions that the checklist marks Not required.

## Phase 18 — Natural Voice Conversation

- Browser voice uses the existing one-shot speech-recognition flow and matches spoken output to Hindi (India) or English (India) responses.
- Browser output prefers a language-matched installed voice, favouring local voices when the browser exposes that information. Available voices vary by browser and device.
- Long browser replies are split at sentence or word boundaries and played sequentially. A new microphone session, a new answer, or Stop speaking cancels the current queue.
- The Orbital Voice settings let the user choose the recognition language, available spoken voice, speaking speed and whether chat replies should be spoken aloud.
- Android Companion prefers an installed offline TTS voice for the reply language when one is available. If only a configured system/network voice exists, Android uses that provider according to its own settings.
- Android replies are queued in bounded chunks instead of being cut off at the previous short reply limit. The persistent notification includes an Interrupt speech action and a separate Stop action.
- Starting a fresh one-shot voice request stops any previous Android speech output.
- Microphone recognition is user-started. The Android Companion prefers on-device recognition when the tablet reports it is available; otherwise the configured Android speech-recognition service may process audio according to that service's privacy settings.
- JARVIS receives the recognized text over HTTPS; raw microphone audio is not uploaded to the JARVIS server by this voice flow.
- This phase does not add wake-word detection, hidden always-on listening, full-duplex audio streaming or voice activity detection. Hands-free mode runs only after the user starts the foreground service and can be stopped from its notification.

## Build

1. Open the `android` directory in Android Studio.
2. Install Android SDK Platform 36 and use JDK 17.
3. Sync Gradle and build the app debug variant.
4. The GitHub Actions Android job also runs `assembleDebug` using Gradle 8.14.6.

The project pins Android Gradle Plugin 8.13.2, Gradle 8.14.6 and Kotlin Gradle Plugin 2.4.21. The source branch includes Gradle wrapper distribution properties but not the wrapper launcher scripts or JAR; Android Studio or the GitHub Actions job can use the configured Gradle distribution.
