# JARVIS Phase 17 — Media and Content Creation Engine

**Status:** CODE_COMPLETE (repository scope; PR #58 CI passed).  
**Branch:** feat/phase-17-media-content-engine  
**Base:** main at 6d66ab38bd382d6ed4f95a9805a48a560a8b0bf5

## Goal

Provide a private, authenticated media workspace that turns a user brief into an editable storyboard and export-ready files, without silently publishing or uploading content.

## Implemented scope

- Three bounded formats: vertical short (720×1280), landscape explainer (1280×720), and square carousel (1080×1080).
- Brief selectors for target platform, language, tone and intended audience.
- Optional AI-assisted storyboard generation using only the existing server-side JARVIS AI provider. If the provider is disabled, unavailable or returns invalid/unsafe output, a deterministic local storyboard template is used.
- Persistent project drafts and approval state stored in the existing jarvis_app_state JSONB record or the existing local JSON fallback. No second database, migration or production cutover is introduced.
- Authenticated list/create/update/approve/delete API routes. Creation is rate limited.
- Scene editor with bounded scene count, per-field text limits and duration limits.
- Browser preview plus approved-only exports: project JSON, editable script TXT, SRT captions, individual PNG scene cards and a silent WebM motion-graphics video rendered with Canvas and MediaRecorder.
- Export files are created locally in the user's browser; no upload or publishing endpoint is present.

## Approval and safety boundaries

- Every new project starts as a draft. Editing is limited to drafts; exports are disabled until the owner approves that storyboard.
- AI generation is optional and server-side. The browser cannot choose model endpoints, credentials, request headers or tools.
- Briefs and generated scenes are screened for credential-like data and selected unsafe content patterns. Scene and project limits prevent unbounded output.
- User briefs and AI results are content, not permission to execute tools or device actions. The media subsystem adds no shell execution, remote URL fetching, social login, uploading or publishing.
- A generated storyboard is not a fact-check. The interface reminds the owner to verify claims and asset rights.

## Export limitations (explicit)

- WebM export produces browser-rendered motion graphics with no audio track. Voiceover is exported as text and SRT captions; no microphone recording, speech synthesis or music generation is included.
- PNG exports are designed title/scene cards, not stock footage or generated photographic assets.
- JARVIS does not upload to YouTube, Instagram, TikTok or other platforms in this phase. The target-platform setting only controls the storyboard/export brief. Publishing requires a separate future phase and explicit review.
- The browser must support Canvas and MediaRecorder/WebM to create the WebM output. JSON, TXT, SRT and PNG exports remain separately available where supported.
- The WebM renderer runs in real time and the user must keep the tab open until it completes.

## Automated acceptance

The Node suite covers format dimensions, local fallback, AI candidate validation and fallback, credential/unsafe-content rejection, storyboard limits, editable-draft versus approved state, and script/SRT output. CI also syntax-checks the Media Studio browser module.

PR #58 head `7afe2eaee846fd32bf10c81f9795d3ed4fa32fb1` passed GitHub Actions run `41466460893`: 226 Node tests passed, zero failed, production dependency audit found zero vulnerabilities, Android unit tests/build passed, APK integrity/metadata verification passed and the debug APK artifact uploaded successfully. Post-merge main CI is a separate final integration check. Physical Samsung Galaxy Tab A9 acceptance remains under Phase 31 and is not claimed here.

## Phase 17 completion gate

- [x] Storyboard engine with bounded formats and safe defaults.
- [x] Local generation independent of an external model key.
- [x] Optional integration with the existing server-side AI provider.
- [x] Draft persistence and authenticated project API.
- [x] Scene editing and explicit approval.
- [x] JSON, script, SRT, PNG and silent WebM exports.
- [x] Automated tests authored and added to the default test command.
- [x] CI passes on the final pull-request head (run 41466460893).
- [ ] Merge PR #58 to main and verify post-merge CI.
