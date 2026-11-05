# JARVIS release and acceptance status

**Snapshot:** 2026-11-05  
**Integrated main changes:** PR #81 (Android workspace and multitrack Media Studio), PR #82 (bounded Canva accessibility drag), and PR #83 (Creator Campaign Studio).  
**Post-merge CI:** GitHub Actions run [42050453514](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/42050453514) completed successfully on main.

This document separates source-code completion from live account, device and production-release acceptance. A passing CI build does not prove that a particular tablet, Canva UI version, browser speech provider or connected account behaves as expected.

## What is now in main

- The Android application opens the JARVIS Workspace in its WebView shell while retaining the native Orb, setup, pairing, voice and local-memory screens.
- Media Studio has a browser-based multitrack timeline with video, overlay and audio tracks; clip positioning, trimming and splitting; keyframes; speed ramps; masks; chroma key; transitions; local video/image/audio assets; and local video export.
- Media Studio can mix user-selected local voiceover/music/audio tracks into the exported video. Source assets remain in the browser session and are not uploaded automatically.
- Creator Studio can draft a short-video campaign, carousel copy/assets, SEO outline, social captions, lead-magnet outline and topic ideas. Trend Radar requires the configured SearXNG search provider.
- Canva has two different integrations: an optional OAuth thumbnail handoff that creates a flat PNG design, and a narrowly scoped Android semantic drag action for exact accessible labels. The latter requires Android 12L/API 32 or newer and the target Canva UI must expose semantic drag actions.
- Android app control remains permission-bounded and uses explicit user approval, visible UI labels, result checks and stop/cancel controls.
- Android hands-free voice is a user-started foreground session. It cycles speech recognition after each utterance and uses an ongoing notification with stop controls. It is not an ambient wake-word service.

## Remaining capability boundaries

| Area | Current boundary | What would count as completion |
| --- | --- | --- |
| Long-form video | Landscape Media Studio render limit is 180 seconds; Creator Studio's 4–20 minute outline is not a finished long-form video. Export uses browser Canvas/MediaRecorder and local files. | A tested long-duration render pipeline with reliable audio/video muxing, resumable jobs, durable asset storage, cancellation, and playback validation on target hardware. |
| Canva timeline editing | OAuth creates a flat thumbnail design. Android drag is only semantic label-to-label, only when Canva exposes the actions. No general clip trim/split/keyframe/audio automation in Canva. | A real Canva Android acceptance session proving each supported operation on the target app version. Unsupported controls must remain manual. |
| Browser automation | JARVIS can open public web destinations/searches and use its bounded Android accessibility controls. It does not provide a general DOM/Playwright agent, authenticated-session automation, CAPTCHA solving, or automatic choice of search results. | A permission-bounded browser runtime with per-action previews, domain policy, visible outcome checks, audit trail and independent security review. |
| Natural voice | Continuous hands-free conversation is available only after the user starts the foreground microphone session. No wake word or hidden/always-on background capture. | A separately designed, opt-in on-device wake-word feature with explicit privacy disclosure, hardware testing and a visible stop path. Do not silently enable microphone capture. |
| Unified Android experience | The APK contains a native shell/Orb and embeds the web Workspace; not every dashboard feature is a native offline screen. | Native offline parity for each required workspace feature, or an explicitly accepted WebView-based product boundary. |
| Physical device acceptance | CI compiles and tests Android source, but cannot prove installation, performance, Accessibility behaviour, microphone reliability or real Canva gestures on the tablet. | Hands-on acceptance on the actual Galaxy Tab A9 (or the actual release device), with results recorded below. |
| Signed production release | A signed-release workflow is now provided, but it requires a private keystore and passwords stored as GitHub Actions secrets. The debug APK is not a production release. | Configure secrets, run the signed-release workflow, verify its signature/checksum, then install the artifact on the target device. |

## Signed Android APK workflow

Workflow: `.github/workflows/release-android.yml`

It runs when manually dispatched or when a tag matching `android-v*` is pushed. It builds the `release` variant, runs Android unit tests, verifies the APK signature with `apksigner`, produces SHA-256 metadata and uploads a signed APK artifact for 14 days. It does not publish to Google Play.

### Required GitHub Actions secrets

Add these under the repository's **Settings → Secrets and variables → Actions**:

- `ANDROID_SIGNING_KEYSTORE_BASE64` — base64-encoded release keystore file.
- `ANDROID_SIGNING_KEY_ALIAS` — alias inside that keystore.
- `ANDROID_SIGNING_STORE_PASSWORD` — keystore password.
- `ANDROID_SIGNING_KEY_PASSWORD` — key password.

Never commit the keystore, its base64 contents, or the passwords. Keep a secure offline backup of the keystore; losing it can prevent future updates signed with the same application identity.

Example: create a new keystore on a trusted machine with `keytool -genkeypair -v -keystore jarvis-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias jarvis-release`. Encode it for the secret value with `base64 -w0 jarvis-release.jks` on GNU/Linux, or `base64 -i jarvis-release.jks | tr -d '\n'` on macOS. The base64 output is secret material and should be pasted only into GitHub's secret form, not into chat or source control.

After all four secrets are configured and the release code is merged, use **Actions → JARVIS Android Signed Release → Run workflow**, or push a version tag such as `android-v0.8.2`. The workflow fails early with a clear error when any required secret is missing. Debug artifacts from the regular CI workflow remain test builds, not release builds.

## Physical device acceptance checklist

Record the device model, Android version, JARVIS APK version, date, and pass/fail result for each item.

- [ ] Install the signed release APK and launch the Workspace; confirm the native Orb, Setup, Back navigation and WebView recovery work.
- [ ] Pair the tablet to the HTTPS JARVIS server; revoke the paired device from the dashboard and confirm its old token no longer works.
- [ ] Grant Accessibility manually, read a non-sensitive screen, tap one unique visible label, type into a user-focused non-sensitive field, scroll, and verify each result.
- [ ] Verify protected controls and credential fields are refused. Confirm Stop/cancel ends the active task and the foreground notification remains visible while hands-free voice is active.
- [ ] Start and stop hands-free voice; test Hindi/Hinglish and English recognition, interruption during speech, and behaviour when the recognition provider is offline/unavailable.
- [ ] Open a public HTTPS website, search a harmless topic, read visible content locally, and confirm result selection, sign-in, consent and CAPTCHA steps remain user-controlled.
- [ ] In the installed Canva version, test only exact accessible-label drag actions with a harmless sample project. Record whether Canva exposes Android semantic drag actions; confirm safe failure when it does not.
- [ ] Export a short multitrack Media Studio project with locally selected voiceover/music, play the exported file on-device, and check timing, sync, transitions, audio levels and playback completion.
- [ ] Test memory save/delete and data export; confirm local Android memory and server Workspace memory remain clearly separate.
- [ ] Verify release APK signature and SHA-256 checksum from the signed-release artifact before wider installation.

**Do not mark a physical-device or Canva item complete from a GitHub Actions result alone.**

## Sign-off record

| Test | Device / environment | Date | Result | Notes |
| --- | --- | --- | --- | --- |
| Android install + workspace | Pending physical test | — | Pending | — |
| Accessibility + app control | Pending physical test | — | Pending | — |
| Hands-free voice + stop controls | Pending physical test | — | Pending | — |
| Canva semantic drag | Pending Canva UI test | — | Pending | — |
| Multitrack export + audio playback | Pending physical test | — | Pending | — |
| Signed release install | Pending signing secrets + device test | — | Pending | — |
