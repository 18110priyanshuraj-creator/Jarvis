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


## Phase 3 — AI planning and permission setup

The server can use the official Google Gen AI JavaScript SDK when GEMINI_API_KEY is configured. Set GEMINI_API_KEY and GEMINI_MODEL in the hosting provider's secret environment settings; never place the real key in source control or the Android app. The current model default in the environment example is gemini-3.8-flash and is configurable.

The Android app sends only the spoken transcript to the authenticated server planning endpoint. It does not upload screenshots, accessibility text or app contents. Gemini returns JSON containing up to six actions from a fixed allow-list. The server validates the schema and the Android app validates the actions again before executing them locally. If Gemini is not configured or is unavailable, voice chat falls back to the existing offline JARVIS core; the offline core is not a general-purpose model.

### Permission checklist

The app distinguishes required permissions from optional or unnecessary access:

- Microphone: required for voice recognition.
- Accessibility: required for reading visible accessibility labels and performing supported screen actions. The user must enable it manually in Android Settings.
- Notifications: recommended so the hands-free session's Stop notification is easy to access. It is not treated as a microphone permission.
- Server pairing: required for remote Gemini planning; basic local app launching does not need pairing.
- Storage and Downloads: not needed by the current Companion.
- Display over other apps: not needed; the Companion does not use a floating overlay.
- Install unknown apps: controlled by the source app (such as the browser or file manager) used to open a manually downloaded APK. JARVIS itself does not request package-install permission.

Android system permission dialogs and protected settings cannot be silently accepted by JARVIS. The checklist opens the relevant Settings page and asks the user to grant access themselves. Do not enable permissions that the checklist marks Not required.

## Phase 4 — conversational AI and voice routing

- The server-side assistant can use Gemini for ordinary questions and follow-up conversation in both the web dashboard and paired Android voice Companion.
- The Android planner classifies a spoken request as `conversation`, `device_action` or `clarification`. Only `device_action` plans reach the local action runner. Normal questions are sent to the authenticated voice-chat endpoint; ambiguous or unsupported actions are clarified instead of executed.
- Conversation replies use up to the eight most recent user/assistant chat messages, with each prior message truncated to 1,200 characters. The current request is limited to 4,000 characters.
- Saved memories, tasks, feedback, custom skills, screenshots and accessibility-screen text are not added to the Gemini conversation prompt.
- The Android request planner is enabled when `GEMINI_API_KEY` is present. It sends the current spoken transcript to Gemini to choose `conversation`, `device_action` or `clarification`; it does not send screenshots or accessibility-screen text.
- Gemini conversation mode is separately opt-in. Set `GEMINI_CHAT_ENABLED=true` in the server environment in addition to `GEMINI_API_KEY`. Dashboard chat uses the offline brain unless both are enabled.
- When conversation mode is enabled, up to eight recent user/assistant chat messages (up to 1,200 characters each) are also sent as context. Saved memories, tasks, feedback, skills, screenshots and Android accessibility-screen text are not included.
- If a configured Gemini conversation call fails, it falls back to the offline brain. Dashboard chat labels show whether a reply came from Gemini, the offline brain or the offline fallback. The API key stays on the server and is never bundled into the APK.

To enable Phase 4 chat, add `GEMINI_CHAT_ENABLED=true` to the Render service environment, keep `GEMINI_API_KEY` secret, and redeploy the feature branch. Do not paste the key into the dashboard, Android app, source files or this chat.
