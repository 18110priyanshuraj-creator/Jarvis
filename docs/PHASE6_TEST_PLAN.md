# Phase 6 — validation and release readiness

Phase 6 validates the existing JARVIS web service and Android Companion without replacing the existing app or merging the feature branch into `main`.

## Current automated validation

GitHub Actions runs on feature-branch pushes and pull requests targeting `main`. Its automated gates are:

- Node.js syntax and regression suite: `npm run check`
- Android debug APK compilation: `gradle -p android --no-daemon assembleDebug`
- APK integrity check: the generated APK must be non-empty and pass ZIP-archive validation
- Artifact verification files: CI publishes the APK, a SHA-256 checksum, and build metadata containing the source commit, branch, workflow run ID and build variant
- Artifact retention: 7 days from upload

The automated suite covers the authenticated dashboard API, session protections, local/offline chat, tasks and memories, Android pairing/heartbeat/revocation, planner and conversation behavior, and live-research source validation and opt-in configuration. A passing CI build proves compilation and automated checks; it does not replace physical-device acceptance.

## Device acceptance matrix — requires a real Android device

CI compiles the APK but does not operate a physical tablet or third-party apps. Run these checks on the target Android device before treating Phase 6 as fully accepted.

| Test | Procedure | Pass condition | Status |
|---|---|---|---|
| Install and launch | Install the CI debug APK manually and open JARVIS Companion | App opens without crashing | Pending device test |
| Pairing | Generate a short-lived code in the authenticated dashboard; pair the app over HTTPS | Device appears in dashboard; raw token is not displayed again | Pending device test |
| Revocation | Revoke the paired device from the dashboard, then try a heartbeat | Revoked token is rejected | Backend automated test passed; device confirmation pending |
| Permissions | Review the disclosure; grant microphone and Accessibility manually; leave unneeded permissions off | App reports the actual permission state; no system permission is silently granted | Pending device test |
| Voice basics | Try one-shot and hands-free voice, including Hindi and English | Recognized commands are handled or a clear fallback is spoken | Pending device test |
| Telegram navigation | Say “Telegram kholo”, then navigate only using visible, unique, non-sensitive labels | App opens and safe navigation works; no message is sent | Pending device test |
| YouTube navigation | Say “Open YouTube”; use a harmless educational search in the visible search field | App opens and search text is entered; no account, purchase or submission action is taken | Pending device test |
| Multi-app flow | Open YouTube, return Home, open Telegram, then return to JARVIS | App switching and Back/Home work without a crash | Pending device test |
| Background and reconnect | Start hands-free mode, switch apps, briefly disconnect/reconnect network, return to JARVIS | Service remains understandable; failed network requests give a clear message and recover on a later request | Pending device test |
| Stop control | Stop using the in-app Stop button, notification Stop action, and spoken “stop listening” command | Microphone session stops and persistent notification is removed | Pending device test |
| Safety boundaries | Try a non-sensitive text field and inspect protected controls without activating them | Text is entered only into a user-focused non-sensitive field; Send/Submit/Delete/Payment/confirmation and security controls remain manual | Pending device test |
| Research feature | With live research disabled, verify it is unavailable; if deliberately enabled by an adult/owner, run a normal educational query and inspect citations | Disabled endpoint refuses requests; enabled results show source links and are not auto-saved | Backend opt-in tests passed; live provider test pending |

### Device-test safety rules

- Use a test account and non-sensitive sample content.
- Do not send messages, publish posts, delete content, make purchases, change account security settings, or submit forms during navigation tests.
- Do not enter passwords, PINs, one-time codes, or private messages through voice typing.
- Grant Accessibility and microphone access only after reviewing Android's own disclosure and only for the test session. Turn them off afterward if no longer needed.
- The Companion does not need broad storage, Downloads, overlay, or install-app permissions. Do not grant them.
- If an app does not expose a unique accessible label, stop that action and use the app manually.

## Release / deployment gate

A successful debug build is not a production deployment. Before a hosted release:

1. Confirm the intended hosting service and that its production URL uses HTTPS.
2. Set a strong unique dashboard password in the host's secret environment settings.
3. Keep `GEMINI_API_KEY` server-side only. Keep `GEMINI_CHAT_ENABLED` and `GEMINI_WEB_RESEARCH_ENABLED` off unless their respective features are intentionally enabled.
4. Review provider usage and billing before enabling live research.
5. Confirm durable storage/backup expectations; the default JSON-file store may be ephemeral on some hosts.
6. Deploy the feature branch to a private/staging service first, verify login, health, pairing and revocation, then decide separately whether to promote it.

No production deployment, merge to `main`, or pull request is performed by this phase checklist. Those are separate release decisions.

## Known limits

- GitHub Actions does not prove the app behaves correctly on a Samsung tablet, in Telegram, or in YouTube.
- The debug APK is not a Play Store release or a signed production package.
- Live Gemini Search was not exercised in CI because the test environment deliberately has no real API key and keeps the feature disabled.
- Physical-device acceptance remains pending until the matrix above is completed on the target device.
