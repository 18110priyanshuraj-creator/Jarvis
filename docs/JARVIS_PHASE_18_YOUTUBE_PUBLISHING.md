# JARVIS Phase 18 — YouTube Publishing Automation

**Status:** CODE_COMPLETE (repository implementation and automated verification merged; live-provider and physical-device acceptance remain external gates)  
**Latest main merge:** `5ae32dc5fd12d9e2c87ea309d079d87a7decb1e6`  
**Implementation PR:** [#60 — merged](https://github.com/18110priyanshuraj-creator/Jarvis/pull/60)  
**Acceptance-test follow-up PR:** [#62 — merged](https://github.com/18110priyanshuraj-creator/Jarvis/pull/62)  
**Source of truth:** `main`

## Goal

Extend the approved Phase 17 Media Studio workflow into a user-controlled YouTube upload path without putting Google credentials in the browser, publishing generated content automatically, or changing existing Google Drive access.

## Implemented scope

- Dedicated YouTube Data API v3 upload service using the narrow `youtube.upload` OAuth scope.
- Incremental Google OAuth capability using the existing server-side OAuth client and AES-256-GCM refresh-token vault. Existing Drive scopes are preserved; YouTube upload permission is requested only after the user selects the YouTube connection action.
- Authenticated YouTube status, preview, cancel and upload endpoints.
- Preview creation is limited to an approved Media Studio project and binds the selected file's name, MIME type and exact byte length to the preview.
- Title, description, tags, optional category, privacy setting and a mandatory made-for-kids declaration are reviewed before upload.
- Content-review and usage-rights confirmations, saved-preview review, exact `PUBLISH` phrase and final browser confirmation are required for each upload.
- Private visibility is the default. Unlisted and Public are explicit choices. Public previews require a parent/guardian review attestation and a second confirmation; this is an attestation, not identity verification.
- Resumable upload streams the selected file through the server, enforces an exact byte count and has a 256 MiB cap. Video bytes are not permanently stored by JARVIS.
- Upload history stores approved metadata, state and any confirmed video URL; OAuth credentials and resumable-session URLs are not recorded there.
- Previews expire after ten minutes. Each preview is single-use, has one active upload at a time and is protected by a three-uploads-per-hour rate limit.
- Subscriber notifications are disabled by default.
- A successful upload receipt requires a valid video ID and a provider state of `uploaded` or `processed`. An undefined or incomplete provider response cannot be recorded as success.
- Uncertain/interrupted uploads move to `needs_review`; JARVIS never automatically retries a transfer that may already have reached YouTube.
- The HTTP server has a bounded request deadline compatible with the 30-minute upstream upload timeout, a 60-second header deadline and a bounded idle-socket timeout.
- Route and service tests cover authentication, no-consent behavior, approved-project gating, file MIME/size checks, exact streamed byte counts, provider URL allow-listing, receipt persistence, duplicate-use rejection, restart recovery, initialization timeout and post-start transfer timeout/no-retry behavior.

## Setup requirements

1. Enable YouTube Data API v3 in the Google Cloud project used by JARVIS.
2. Keep the existing Google OAuth client ID, client secret, HTTPS callback URL and 32-byte `JARVIS_TOKEN_ENCRYPTION_KEY` in private hosting environment settings. Do not place secrets in source control or chat.
3. Ensure the OAuth consent configuration and account are eligible to request `youtube.upload`. The owner must complete Google's own consent and eligibility process. JARVIS does not bypass age, consent or account restrictions.
4. Approve a storyboard in Media Studio and export an MP4, WebM or QuickTime video before creating a YouTube preview. The existing Media Studio WebM export is silent; it does not add narration or external stock media automatically.

## Safety and privacy contract

- Uploading is never triggered by a workflow, generated storyboard, voice command, page load or OAuth callback alone.
- Google access tokens remain server-side in memory; refresh tokens remain encrypted at rest. Credentials are not returned to the browser or stored in publication history.
- Only the narrow `youtube.upload` scope is requested for YouTube; channel management and analytics scopes are not requested.
- Each upload requires explicit user action. Public visibility is not the default and must not proceed without the required parent/guardian review and separate confirmation.
- The parent/guardian review field is an attestation only. JARVIS cannot independently verify guardian identity, account ownership, content rights, audience suitability or YouTube channel eligibility.
- If the upload response is uncertain, or YouTube accepts it but JARVIS cannot save the receipt, the UI instructs the user to check YouTube Studio. JARVIS does not retry automatically.

## Boundaries and remaining acceptance

- This phase uploads an already rendered MP4, WebM or QuickTime file up to 256 MiB. It does not create an audio track, generate photographic footage, schedule future posts or create thumbnails.
- A successful API response confirms that YouTube accepted the upload; subsequent processing and visibility may continue.
- No live YouTube upload was executed during development. Real-provider acceptance requires the owner's eligible Google Cloud project, OAuth consent and channel, with parent/guardian supervision where required.
- Samsung Galaxy Tab A9 physical UI, file-picker, large-upload stability and lifecycle acceptance remain in Phase 31. Repository CI and APK generation do not substitute for actual device testing.

## Verification evidence

### Implementation PR #60

Merged to `main` at `1e3023d801a191e30cb8e100f1350ecee6992413`.

- Added the least-privilege OAuth capability and existing-vault integration.
- Added authenticated preview/cancel/upload/status routes and the Media Studio publishing UI.
- Added private-by-default visibility, explicit confirmations, resumable upload and uncertain-outcome handling.
- Fixed the upload receipt path to use the actual provider result and require a valid video ID plus a confirmed upload state.
- Raised the HTTP request deadline to support bounded large-file uploads while retaining header and idle-connection timeouts.

### Acceptance-test follow-up PR #62

Merged to `main` at `5ae32dc5fd12d9e2c87ea309d079d87a7decb1e6`.

GitHub Actions run [41576535364](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41576535364) passed on the PR head:

- Node suite: **245/245 passed**.
- Production dependency audit: **0 vulnerabilities**.
- Android `testDebugUnitTest` and `assembleDebug`: passed.
- APK integrity verification and artifact upload: passed.

The route tests use an isolated mocked Google OAuth/YouTube provider. They verify upload behavior and recovery without claiming a real account upload.

### Post-merge main verification

The main commit before the test-only follow-up, `ae52cde400752c16c68672a81ec23d84da1a2c9a`, passed GitHub Actions run [41574427339](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41574427339): 243/243 Node tests, zero production vulnerabilities, Android unit tests/build, APK integrity verification and artifact upload.

Post-merge CI for the latest merge commit `5ae32dc5fd12d9e2c87ea309d079d87a7decb1e6` is run [41576949771](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41576949771); its final result is recorded separately from the already-passing PR CI.

### Debug APK artifact

The verified debug APK from main CI run 41574427339 is artifact `13202274984` (`jarvis-companion-debug`), generated from `ae52cde400752c16c68672a81ec23d84da1a2c9a`. The APK SHA-256 is:

```
bac67ac59f3571796a05a6efa2f5d9fd7cd2ec9b0d5246521ba77cc34f07be0c
```

This is a debug APK, not a signed production release. Installing it on a Galaxy Tab A9 and exercising the real YouTube OAuth/file-picker/upload flow is a Phase 31 activity.

## Completion checklist

- [x] Dedicated least-privilege `youtube.upload` OAuth and incremental consent.
- [x] Approved-project-only preview and explicit content/rights/audience/privacy review.
- [x] Private-by-default visibility and separate public-visibility safeguards.
- [x] Exact `PUBLISH` confirmation, expiring preview and one-use upload attempt.
- [x] Resumable server-streamed upload with MIME and exact byte-count enforcement.
- [x] Upload receipt validation against the actual provider response.
- [x] Interrupted/uncertain upload recovery without automatic replay.
- [x] Authentication and no-consent route tests.
- [x] MIME mismatch and upload timeout/no-retry tests.
- [x] Node tests, dependency audit, Android unit/build/APK integrity and artifact upload passed on PR #62.
- [x] PR #60 and PR #62 merged to `main`.
- [ ] Live Google OAuth and YouTube channel upload acceptance: owner-supervised external gate; not performed.
- [ ] Physical Samsung Galaxy Tab A9 workflow acceptance: Phase 31; not performed here.

**Phase result:** CODE_COMPLETE for repository implementation and automated verification. Real-provider and physical-device acceptance are explicitly pending; this report does not claim they passed.
