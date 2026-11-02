# Phase 11 — Screen Observation

**Status:** VERIFIED — merged into `main` via PR #50; the final post-merge main CI run passed. Physical Samsung Galaxy Tab A9 acceptance remains Phase 31.  
**Scope:** Explicit, one-shot Android screen observation combining accessibility labels with local OCR.  
**Branch:** `main` (merged via PR #50)

## Goal

Let the owner ask JARVIS what is visible on the Android display. Use the accessibility tree where apps expose it and a single screenshot for on-device text recognition when Android supports it. Observation is read-only: it does not authorize a tap, text entry, submit, send, or other follow-on action.

## User flow

1. The owner explicitly starts the existing hands-free session and enables the JARVIS Accessibility service in Android Settings.
2. The owner says a supported request such as `read screen`, `describe my screen`, `what does this page say`, or `screen pe kya likha hai`.
3. JARVIS requests one screenshot of the default display through Android's AccessibilityService screenshot API (Android 11 / API 30 or later).
4. The screenshot is converted to a bounded in-memory bitmap and processed by bundled ML Kit Latin and Devanagari text-recognition models.
5. OCR lines are combined with the bounded accessibility-tree summary, common sensitive values are redacted, and the result is spoken locally.
6. The screenshot, bitmap, and OCR result are discarded after the request completes.

The observer rejects overlapping capture requests and throttles consecutive requests. It does not run on accessibility events and does not record a video or monitor the screen continuously.

## Privacy and security boundaries

- Screen observation requires an explicit spoken request during the user-started hands-free session.
- Accessibility must be enabled manually by the owner. Android 11+ has the screenshot capability declared in the versioned accessibility-service configuration.
- Both OCR models are bundled with the Android app; recognition does not require a network request or a first-use model download.
- Raw screenshot pixels and recognized text remain in process memory on the device. They are not written to files, preferences, the Room database, activity logs, analytics, or the JARVIS server.
- Spoken screen results force an installed offline Android TTS voice. If none is available, JARVIS does not pass the screen text to a network voice; it asks the owner to install local Hindi or English speech data.
- Screen output is bounded to 32 lines and 1,800 characters. Traversal is capped at 150 accessibility nodes and depth 18; OCR input is resized to a maximum 1,920-pixel dimension.
- The output sanitizer hides detected email addresses, long numeric strings, formatted phone-like numbers, and values following common password/PIN/OTP labels. This is a best-effort safeguard, not a guarantee that every personal detail can be identified.
- Password accessibility nodes and visible password/PIN/OTP/verification/CVV labels block visual screenshot capture entirely; JARVIS falls back to accessible labels only. Editable values are not read from the accessibility tree.
- Android secure windows may refuse screenshots. In that case, JARVIS falls back to accessible labels and says visual capture was unavailable.
- Android 10 and earlier do not use screenshot OCR in this implementation; they retain the existing accessibility-only summary.
- The owner can disable the Accessibility service at any time in Android Settings.

## Implementation

- `ScreenObserver` retains bounded accessibility-tree traversal and adds `observeOnce` for asynchronous screenshot + OCR.
- `ScreenObservationText` is a pure Kotlin formatting/redaction layer so its limits and privacy filters can be unit-tested.
- `LocalCommandProcessor` recognizes explicit English and Hinglish screen-observation phrases.
- `VoiceControlService` intercepts those phrases locally and speaks the result without calling the remote conversation or planner endpoints.
- `accessibility_service_config.xml` remains the pre-Android-11 fallback; `xml-v30/accessibility_service_config.xml` opts into the screenshot capability on Android 11+.
- The setup disclosure and Android Accessibility service description explain one-shot capture and local-only processing.
- No server API, workflow executor, external integration, production environment variable, or database schema was changed.

## Verification plan

- JVM tests cover secret/contact redaction, duplicate removal, output bounds, and English/Hinglish command recognition.
- Repository CI must pass the Node test and production-dependency audit jobs as well as Android unit tests, debug APK assembly, APK integrity verification, and artifact upload.
- Physical Samsung Galaxy Tab A9 checks remain part of Phase 31. Automated CI cannot prove the device's installed Android version, system accessibility settings, secure-window behavior, OCR accuracy on real apps, or spoken result quality.


## Automated verification results

Verified on final implementation commit `01781ea049bb6b4d7af7c7c793a885d03b1043ec`.

- GitHub Actions run [41426668047](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41426668047): passed.
- Node.js: 197 tests passed, 0 failed.
- Production dependency audit: 0 vulnerabilities found.
- Android: `gradle -p android --no-daemon testDebugUnitTest assembleDebug` completed successfully.
- APK archive verification and SHA-256 metadata generation passed.
- Debug APK artifact: `jarvis-companion-debug`, artifact ID `13131309258`, 23,957,436 bytes; includes APK, checksum, and build metadata. GitHub retains it through 2026-11-09.

Physical Samsung Galaxy Tab A9 acceptance remains scheduled for Phase 31. CI verifies the Android build and JVM unit tests, not real-device screenshot permission, secure-window fallback, OCR accuracy, or offline TTS installation.


## Merge and final main-branch verification

- Squash-merged through [PR #50](https://github.com/18110priyanshuraj-creator/Jarvis/pull/50).
- Merge commit: `b706a0fcbbb78cc6e8b03cc07a7e99fb6caaacb3`.
- Post-merge main CI [run 41427377450](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41427377450): both jobs passed.
- Final main verification: 197 Node tests passed, 0 failed; production dependency audit found 0 vulnerabilities; Android unit tests, debug APK build, integrity checks, checksum generation, and artifact upload passed.
- Final main debug artifact: `jarvis-companion-debug`, artifact ID `13132796485`, 23,957,412 bytes; GitHub retains it through 2026-11-09.

## Known limitations

- This is screen text observation, not general image understanding. It does not identify arbitrary objects, interpret charts reliably, understand video, or explain icons that expose no accessibility labels or readable text.
- OCR can omit, reorder, or misread content. Important values must be checked visually.
- Secure or DRM-protected windows may block screenshots; JARVIS then has only the accessible labels.
- The privacy redactor is heuristic. The feature should not be used as a secure credential-reading tool.
- It captures only one default-display frame per explicit request; no continuous capture, remote viewing, or automatic follow-up actions are supported.
