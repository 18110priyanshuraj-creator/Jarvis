# JARVIS Phase 18 — YouTube Publishing Automation

**Status:** CODE_COMPLETE (repository implementation merged; live-provider and physical-device acceptance remain open)  
**Main merge commit:** `1e3023d801a191e30cb8e100f1350ecee6992413`  
**Pull request:** [#60 — merged](https://github.com/18110priyanshuraj-creator/Jarvis/pull/60)  
**Implementation branch:** `feat/phase-18-youtube-publishing` (merged; retained until branch-cleanup permission is available)

## Goal

Extend the approved Phase 17 Media Studio workflow into a user-controlled YouTube upload path without putting Google credentials in the browser, publishing generated content automatically, or changing existing Google Drive access.

## Implemented scope

- Dedicated YouTube Data API v3 upload service using the narrow `youtube.upload` OAuth scope.
- Incremental Google OAuth capability. JARVIS reuses its existing server-side Google OAuth client and AES-256-GCM refresh-token vault; existing Drive scopes are preserved when YouTube upload permission is granted. YouTube permission is requested only after the user chooses Connect Google for YouTube uploads.
- Authenticated YouTube status, preview, cancel and upload endpoints.
- Preview is limited to an approved Media Studio project and requires the exact file metadata, title, description, tags, optional category, privacy setting and a mandatory made-for-kids declaration.
- The owner must tick content-review and usage-rights confirmations, review the saved preview, type the exact confirmation phrase `PUBLISH`, and complete a final browser confirmation before upload. Public uploads require parent/guardian review and an additional confirmation.
- Default visibility is Private. Unlisted and Public are explicit choices with warnings. Public previews require an additional parent/guardian review attestation before the server creates the preview.
- Resumable upload streams the selected file directly through the server. JARVIS counts bytes as they stream and refuses payloads that differ from the preview-approved size. JARVIS does not permanently store video bytes. Server cap is 256 MiB for controlled hosting/resource use.
- Upload history stores only the chosen metadata, status and confirmed video link; no access token, refresh token or resumable session URL is stored.
- Short-lived previews expire after ten minutes. An upload attempt is single-use; no automatic retry follows a network failure. Interrupted in-flight states are recovered as `needs_review` after restart so the owner checks YouTube Studio before creating another attempt.
- Rate limit of three upload requests per hour and one active upload per preview.
- Subscriber notifications are disabled by default.
- Upload receipts are validated against the actual provider result: a valid returned video ID and a confirmed `uploaded` or `processed` state are required before JARVIS records success.
- The HTTP server allows a bounded 31-minute request deadline for large uploads, a 60-second headers deadline and a bounded 31-minute idle-socket timeout. This avoids the previous 95-second total-request cutoff while retaining a hard idle-connection cleanup bound compatible with the upstream 30-minute upload timeout.
- A mocked-provider route integration test covers authenticated access, interrupted-upload recovery, preview-size rejection, OAuth token refresh, resumable upload, receipt persistence and duplicate-attempt rejection. It does not represent a live YouTube upload.

## Setup requirements

1. In the Google Cloud project used by JARVIS, enable YouTube Data API v3.
2. Keep the existing Google OAuth client ID, client secret, HTTPS callback URL and 32-byte `JARVIS_TOKEN_ENCRYPTION_KEY` in private hosting environment settings. No new secret or additional callback path is introduced.
3. Ensure the Google OAuth consent configuration is eligible to request the `youtube.upload` scope. The user must complete Google's account-consent process; JARVIS does not bypass restricted, unverified or age-eligibility checks.
4. In Media Studio, approve a storyboard and export a video file. Phase 17's silent WebM export remains silent; it does not add audio or stock imagery.

## Safety and privacy contract

- Uploading is never triggered by a workflow, generated storyboard, voice command, page load or OAuth callback.
- Google access tokens remain server-side in process memory and refresh tokens remain encrypted at rest. No credential is returned to the browser or written to upload history.
- Only `youtube.upload` is requested for YouTube. JARVIS does not request channel management, analytics or broader account scopes.
- Each upload is an explicit action. Public visibility is not the default, requires parent/guardian review, and receives two confirmation prompts. Subscriber notifications are disabled by default.
- JARVIS cannot determine whether a video is lawful, accurate, age-appropriate or eligible for the account. The owner must review content, rights, privacy and audience metadata, and comply with YouTube and Google account requirements. Required parent or guardian supervision is not bypassed.
- If the upload response is uncertain, or YouTube accepted the upload but JARVIS could not persist the receipt, the UI tells the owner to check YouTube Studio. JARVIS never replays a possibly completed upload automatically.

## Boundaries and remaining acceptance

- This phase uploads an already rendered MP4, WebM or QuickTime file up to 256 MiB. It does not create sound, render photographic footage, schedule a future post, create thumbnails, or publish automatically.
- A successful API response confirms that YouTube accepted the upload; video processing and visibility can continue afterwards.
- Real Google OAuth and YouTube upload need the owner's configured Google Cloud project, consent and eligible channel. No live upload is executed during development.
- Samsung Galaxy Tab A9 physical UI, file picker, large upload stability and lifecycle acceptance remain under Phase 31.

## Branch CI evidence

GitHub Actions run [41482952684](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41482952684) passed on feature head `300b03ab03301b6f1a369d6674f0f7c1c2e80c92`:

- Node suite: 240/240 passed.
- Production dependency audit: 0 vulnerabilities.
- Android `testDebugUnitTest` and `assembleDebug`: passed.
- APK integrity check and artifact upload: passed.
- Debug APK artifact: `jarvis-companion-debug`, artifact ID `13159414246`, SHA-256 `0f4a6a9bd8bc62120b5cfdea8f3bd1af1daaa18dab661f28ea88806d2b2a2eab`, expires 2026-11-09.

PR #60 was squash-merged to `main` at `1e3023d801a191e30cb8e100f1350ecee6992413`. The current post-merge main CI run is [41574164866](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41574164866): its Node suite and production dependency audit passed (243/243 tests; zero production vulnerabilities); the Android Companion build/APK job was still running at the time of this update. The pre-merge current-head Node checks also passed (243/243, zero production vulnerabilities). The original feature CI run [41483967173](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41483967173) completed successfully, including Android unit/build/APK checks, but preceded the final receipt/timeout hardening. The feature branch was merged, but could not be deleted because the connected GitHub toolset does not expose a branch-deletion action; it is retained, not treated as a production branch. The upload-receipt defect and route-test coverage were hardened on the same feature branch. An initial hardening run exposed that the test's fourth upload request correctly hit the production three-per-hour limiter (242 passed, 1 failed); the test was adjusted to stay within the real limit without changing production rate limiting. The corrected branch head is being rechecked by GitHub Actions before merge.

## Completion gates

- [x] Dedicated YouTube upload scope and incremental OAuth tested.
- [x] Approved-project-only preview and explicit rights/audience/privacy review tested.
- [x] Resumable server-streamed upload tested with a mock provider, including exact byte-count enforcement.
- [x] Authentication and no-consent guards are covered in server route tests.
- [x] Mock-provider route test covers exact preview-size rejection, upload receipt persistence, duplicate-use rejection and interrupted-upload recovery.
- [x] Service tests cover approved-project review, supported MIME types, 256 MiB cap, byte-count enforcement, URL allow-listing and no automatic retry.
- [x] Current PR-head Node suite and production dependency audit passed (243/243; 0 production vulnerabilities).
- [x] PR #60 merged to `main` at `1e3023d801a191e30cb8e100f1350ecee6992413`.
- [x] Post-merge main Node suite and production dependency audit passed (243/243; 0 production vulnerabilities).
- [ ] Post-merge Android Companion build, APK integrity verification and artifact upload must finish successfully.
- [ ] Additional real-network timeout and MIME mismatch route tests remain a hardening gap.
- [ ] Real Google OAuth/YouTube channel upload acceptance remains an owner-supervised external gate; no live upload was performed.
- [ ] Physical Samsung Galaxy Tab A9 workflow acceptance remains Phase 31.
- [ ] Real account upload and physical tablet acceptance recorded separately; no live upload was performed as part of this implementation.
