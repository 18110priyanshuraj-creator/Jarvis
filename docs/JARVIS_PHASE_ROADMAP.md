# JARVIS Phase 0 + Phase 1–32 Roadmap

**Roadmap baseline:** 2026-11-02  
**Repository baseline:** `8b00096ea7b62611d5275656a292d5db78c07a72`  
**Rule:** Historical implementation labels are evidence, not automatic completion of the new 32-phase plan.

## Status legend

- `VERIFIED` — acceptance evidence exists for the stated scope.
- `PARTIAL` — some implementation exists, but the new phase acceptance criteria are not met.
- `IN_PROGRESS` — active work is underway.
- `CODE_COMPLETE` — repository implementation and automated checks are complete; required physical-device acceptance may still be pending.
- `BLOCKED` — work depends on an unresolved external or preservation gate.
- `NOT_STARTED` — no material implementation found.
- `NEEDS_REVIEW` — present but requires focused validation.

## Phase 0 — Existing project audit and preservation gate


**Status: COMPLETE FOR AUDIT / PHASE 1 ENTRY (legacy data migration guard remains open)**

Completed: repository/main identification, current branch/PR inventory, old production snapshot comparison, code/technology inventory, CI evidence, Android capability boundary, security review, successful CI on the closeout commit, Render deployment reconciliation to main, Neon schema inventory and verified Neon snapshot.

Carry-forward guards before any data migration or source-of-truth cutover: recover/archive legacy JSON and chat history, verify Render's active DATABASE_URL without exposing it, reconcile Blueprint settings before applying them, and choose branch protection. Physical Samsung tablet acceptance remains Phase 31.

See:
- `JARVIS_PHASE_0_AUDIT.md`
- `JARVIS_EXISTING_FEATURE_MATRIX.md`
- `JARVIS_BRANCH_AUDIT.md`
- `JARVIS_SECURITY_AUDIT.md`
- `JARVIS_FINAL_ARCHITECTURE.md`

## Phase 1–32 status map

| Phase | Target scope | Current status | Existing evidence and remaining gap |
|---|---|---|---|
| 1 | Central Orb Interface | CODE_COMPLETE | Native Android orb home is responsive, keyboard-send enabled and accessibility-aware; CI verifies code/build. Physical Galaxy Tab A9 acceptance remains scheduled under Phase 31. |
| 2 | Unified All-in-One Application Shell | CODE_COMPLETE | Existing authenticated dashboard is integrated in the Android shell; origin restrictions, OAuth system-browser handoff, native confirmation dialogs, WebView lifecycle/recovery and automated CI are implemented. Galaxy Tab A9 acceptance remains Phase 31. See `JARVIS_PHASE_2_APP_SHELL.md`. |
| 3 | Native Android Core | CODE_COMPLETE | Application-scoped native runtime now unifies typed input, one-shot voice and hands-free routes; Room v1 stores a bounded privacy-minimized 500-entry execution journal. Node/Android CI and APK verification passed; Galaxy Tab A9 acceptance remains Phase 31. See `JARVIS_PHASE_3_NATIVE_ANDROID_CORE.md`. |
| 4 | Local System Controller | CODE_COMPLETE | One app-scoped local controller routes status, media-volume and Android Settings commands before the existing app launcher or optional remote assistant; automated command/policy tests pass. Physical Galaxy Tab A9 checks remain Phase 31. See `JARVIS_PHASE_4_LOCAL_SYSTEM_CONTROLLER.md`. |
| 5 | Offline Voice System | CODE_COMPLETE | One-shot and hands-free voice now share on-device-first policy with persistent Prefer offline / Offline only modes; offline-only refuses online recognition and network TTS fallbacks. Actual language-pack/device acceptance remains Phase 31. See `JARVIS_PHASE_5_OFFLINE_VOICE.md`. |
| 6 | Independent Intelligence Engine | CODE_COMPLETE | Deterministic offline-first routing, local-first device planning, secret-safe capability status and optional model fallback are tested; no general local LLM is claimed. |
| 7 | Natural Language Understanding | CODE_COMPLETE | Shared deterministic English/Hindi/Hinglish intent labels, heuristic confidence metadata and 18 multilingual regression examples; classification alone cannot execute Android actions. |
| 8 | Local Memory System | CODE_COMPLETE | Separate on-device Room v1 store, Android Keystore AES-GCM encryption, explicit local remember/recall/exact-forget, and native add/search/edit/pause/resume/delete UI. CI run 41400751209 passed Node (183/183, 0 audit vulnerabilities) and Android testDebugUnitTest assembleDebug plus APK verification/upload. Physical Tab A9 Keystore/UI checks remain Phase 31. |
| 9 | Autonomous Task Planner | CODE_COMPLETE | Authenticated dashboard goal-to-workflow planner; deterministic local templates before optional server model fallback; clarification/assumption handling; eight allow-listed step categories, private-data screening and no-execution plan previews; explicit save-as-draft and existing validate/approve/run gates. CI run 41402806377 passed 191 Node tests, zero vulnerabilities, Android unit tests/build and APK verification. Render is live; real-world workflow use remains user-approved. |
| 10 | Persistent Execution Engine | VERIFIED | Implemented and squash-merged to `main` at `c905ec6ac01fdfe7113fd7e7858247eecd0fef48`. GitHub Actions run 41423001200 passed: 197 Node tests, 0 production dependency vulnerabilities, Android unit tests/build, APK integrity and artifact upload. Includes durable per-step checkpoints, idempotent writes, persisted single-worker queue, safe pause/resume/stop, restart recovery, bounded retry, 60-second timeout, privacy-minimized Android progress journal and voice controls. Galaxy Tab A9 physical acceptance remains Phase 31. See `JARVIS_PHASE_10_PERSISTENT_EXECUTION.md`. |
| 11 | Screen Observation | VERIFIED | Merged via PR #50 at `b706a0f`; post-merge main CI run 41427377450 passed (197 Node tests, Android unit/build/APK checks, zero production vulnerabilities). Physical Tab A9 acceptance remains Phase 31. |
| 12 | Android Action Engine | VERIFIED | Merged via PR #51 at `13093c6`; post-merge main CI run 41431242469 passed (197 Node tests, Android unit/build/APK checks, zero production vulnerabilities). Physical Tab A9 acceptance remains Phase 31. |
| 13 | Universal Application Skill Registry | VERIFIED | Merged via PR #52 at `d149c1d`; post-merge main CI run 41435305226 passed (Node 203 tests, zero production vulnerabilities, Android unit/build/APK verification and artifact upload). Physical Galaxy Tab A9 acceptance remains Phase 31. |
| 14 | Error Detection and Recovery | VERIFIED | Merged via PR #53 at `11acb45`; PR CI run 41438465662 passed (208 Node tests, zero production vulnerabilities, Android build/unit/APK verification and artifact upload). Post-merge main Node passed in run 41438983665; its duplicate Android job was still in progress, on an identical source tree to the green PR run. Hardware acceptance remains Phase 31. |
| 15 | Full Android Task Integration | VERIFIED (repository/automated scope) | Original PR #54 and verification hardening PR #55 are merged; PR CI #41451937432 and post-merge main CI #41452457643 passed (209 Node tests, 0 failures, 0 production vulnerabilities, Android unit tests/build/APK integrity). Search submission/results remain a manual handoff; physical Galaxy Tab A9 acceptance remains Phase 31. |
| 16 | Internet and Google Research | CODE_COMPLETE (repository scope) | Existing authenticated SearXNG search, signed page-read tokens, secure full-page reader and source-grounded multi-source answers are retained. Native Android adds a no-AI-key Google handoff with fixed HTTPS URL construction, foreground-handler verification and an explicit user approval/manual result-selection gate. PR #57 and post-merge main CI passed (211 Node tests, zero production vulnerabilities, Android unit tests/build/APK verification). Production SearXNG service health still needs owner-selected Render workspace verification; physical Tab A9 acceptance remains Phase 31. See `JARVIS_PHASE_16_INTERNET_RESEARCH.md`. |
| 17 | Media and Content Creation Engine | CODE_COMPLETE (repository scope) | Private authenticated Media Studio with optional AI/local fallback, editable approved-only storyboards, JSON/script/SRT/PNG/silent-WebM exports. PR #58 CI run 41466460893 and post-merge main CI run 41467416089 both passed: 226/226 Node tests, 0 dependency vulnerabilities, Android unit/build/APK verification/upload. Physical Tab A9 acceptance remains Phase 31; audio and social publishing are not part of this phase. See `JARVIS_PHASE_17_MEDIA_CONTENT.md`. |
| 18 | YouTube Publishing Automation | CODE_COMPLETE (repository scope) | PR #60, test-hardening PR #62 and documentation closeout PR #63 are merged to `main`; latest closeout merge is `2c0a3b253db7fa0baccdce183e3bb3d9d7bea225`. Post-merge main CI run 41576949771 passed Node tests/audit and Android unit/build/APK verification; PR #63 CI run 41577065638 also passed both jobs. PR #62 acceptance run 41576535364 passed 245/245 Node tests and zero production vulnerabilities. Real owner-supervised Google/YouTube account upload remains external; physical Galaxy Tab A9 testing remains Phase 31. See `JARVIS_PHASE_18_YOUTUBE_PUBLISHING.md`. |
| 19 | Independent Learning | CODE_COMPLETE (repository scope) | Explicit `Learn: title | lesson`, `Teach JARVIS:` and `Sikhao:` commands save one safe user-authored lesson into the existing Knowledge Library. The authenticated read-only learning preview shows the bounded offline retrieval context; user-authored and user-reviewed entries may be retrieved, while unreviewed/rejected web research is excluded. No ordinary chat is auto-saved, no model weights are trained and no automatic fact-checking is claimed. Physical Galaxy Tab A9 acceptance remains Phase 31. See `JARVIS_PHASE_19_INDEPENDENT_LEARNING.md`. |
| 20 | Knowledge Manager | CODE_COMPLETE (repository scope) | PR #65 is merged to `main` at `11351868839059a5148bb66d5ffcf97fbc20a82e`. GitHub Actions PR run `41598828117` passed 260/260 Node tests, production dependency audit (0 vulnerabilities), Android unit tests, debug build, APK integrity verification and artifact upload (`jarvis-companion-debug`, artifact `13213871772`, expires 2026-11-10). Implements authenticated document upload/list/search/edit/review/download/delete, collections/tags, SHA-256 deduplication, 15 MiB per file, 120 files/200 MiB aggregate limits, TXT/Markdown/CSV/JSON offline indexing and review-gated retrieval. PDF/image/audio/video files are metadata-only attachments; no PDF parsing, OCR or transcription is claimed. Production must use a confirmed durable mounted volume (`JARVIS_DOCUMENTS_DIR` or `JARVIS_DATA_DIR`); JARVIS reports configuration but cannot verify host retention. Physical Galaxy Tab A9 picker/download tests remain Phase 31. See `JARVIS_PHASE_20_KNOWLEDGE_MANAGER.md`. |
| 21 | Self-Evolving Skill Crucible | CODE_COMPLETE | PR #69 merged at `0c6c01b`; CI run `41601724924` passed 269/269 Node tests, zero production dependency vulnerabilities, Android unit/build/APK verification. The allow-listed four-step DSL is linked to approved skill versions, test-gated, hash-checked and manually run; no arbitrary JavaScript, shell, filesystem, network, integration or Android action capability. Physical tablet acceptance remains Phase 31. See `JARVIS_PHASE_21_SKILL_CRUCIBLE.md`. |
| 22 | Proactive Auto-Heal Engine | CODE_COMPLETE (repository scope) | Core implementation PR #71 merged to `main` at `aa6f708f1f0559a2132bfd04c77100b0f55c5390`; post-merge CI run `41604274714` passed 281/281 Node tests, zero production dependency vulnerabilities, Android unit/build/APK verification. Dashboard controller, API guard tests and Phase 22 closeout docs are delivered in follow-up PR #72. Only workflow timeouts can create a tested +15-second proposal, bounded to 120 seconds; runtime timeout is 10–120 seconds and manual retry cap 1–3. Every change needs explicit approval and revision match; rollback restores the previous settings only if nothing changed after apply. No automatic retries/repairs, source edits, secret/storage/permission changes, shell execution or external actions. Physical tablet acceptance remains Phase 31. See `JARVIS_PHASE_22_AUTO_HEAL.md`. |
| 23 | Specialist Intelligence Workers | NOT_STARTED | No coordinated internal specialist-worker runtime. |
| 24 | Proactive Personal Assistant | PARTIAL | Task list and workflows exist; no reliable scheduler/recurrence engine. |
| 25 | Advanced File Management | NOT_STARTED | No verified local PDF/image/audio/video document manager or converter. |
| 26 | Hardware Intelligence | NOT_STARTED | No hardware reference or circuit-validation subsystem. |
| 27 | Geospatial Intelligence | NOT_STARTED | No map/location subsystem. |
| 28 | Advanced Voice Experience | PARTIAL | User-started voice and interruption exist; no wake word or guaranteed offline continuous conversation. |
| 29 | Security and Reliability | PARTIAL | Baseline security mechanisms exist; production migration, branch protection and device review remain open. |
| 30 | Final Central Orb and System Integration | PARTIAL | Browser and Companion are not one integrated Android application. |
| 31 | Real Device Acceptance Testing | BLOCKED | No Samsung Galaxy Tab A9 test evidence in this audit. |
| 32 | Final Production Release | BLOCKED | Only debug APK CI evidence exists; no signed unified Android release. |

## Development order and gates

1. Phase 0 audit and current Render source reconciliation are complete. Legacy data recovery remains a hard gate before migrations or storage cutovers.
2. Phase 1 native orb implementation is code-complete; keep its physical Galaxy Tab A9 checks in Phase 31.
3. Phase 2 application-shell implementation is code-complete: the existing authenticated workspace is embedded in the native Android shell, with external-browser OAuth and tested WebView boundaries. Keep physical Galaxy Tab A9 acceptance in Phase 31.
4. Phase 3 native Android core is code-complete: the shared local-first dispatcher and additive Room execution ledger passed automated acceptance without replacing server data or Keystore credentials.
5. Phase 4 local system controller is code-complete: typed input, one-shot voice and hands-free requests share a permission-aware on-device system boundary; physical Galaxy Tab A9 checks remain Phase 31.
6. Phase 5 offline voice system is code-complete: both Android voice input paths use one on-device selection policy, offline-only mode blocks online speech fallbacks, and TTS honors local-voice requirements. Device-specific model and audio acceptance remains Phase 31.
7. Phase 6 is code-complete: supported deterministic requests route offline before the optional model adapter, current-information requests retain live-research precedence, and bounded Android device plans prefer local rules. See `JARVIS_PHASE_6_INDEPENDENT_INTELLIGENCE_ENGINE.md`.
8. Phase 8 is code-complete at the repository/CI level: a separate Android-local encrypted memory store and native CRUD UI pass Node and Android CI. Local memories are never automatically sent to the server; no server-state import or migration was performed. See `JARVIS_PHASE_8_LOCAL_MEMORY.md`.
9. Phase 9 is code-complete: goal planning is exposed in the authenticated Workflows area, generates drafts only, and retains the existing validation, approval and execution gates. Deterministic templates run before optional model planning; no workflow or task is created by planning itself. See `JARVIS_PHASE_9_AUTONOMOUS_TASK_PLANNER.md`.
10. Retain all current tests and add new regression/acceptance tests.
11. Keep `main` as the release source of truth; use short-lived branches only when useful.
12. Do not delete branches with unreviewed unique work or mark a phase verified because a file exists.
13. Device-only acceptance must be marked blocked until an actual Galaxy Tab A9 observation is recorded.
14. The final release must be a signed, installable Android build with migration, offline behavior and real-device evidence.

## Phase 8 closeout evidence

- Main implementation commit: `8777b29f8c32ed3ae97b96a36cb7cc20b79e52ff`.
- GitHub Actions run `41400751209`: Node tests passed (183/183), production dependency audit reported 0 vulnerabilities, and Android `testDebugUnitTest assembleDebug` completed successfully. APK verification and upload passed.
- Debug APK artifact: `jarvis-companion-debug`, artifact ID `13121625476`, SHA-256 `ec2d74774a18156b539cba0ea89340042a8a9876900cf5a6e7f3a46fecd0034b`, expires 2026-11-09.
- Render deployment `dep-dbk2tr6417fc73bgneag` for the main commit is live. Phase 8 memory code is Android-native; no backend memory migration or API was introduced.
- Samsung Galaxy Tab A9 Keystore and UI behavior have not been physically tested; keep these acceptance checks in Phase 31.

## Phase 9 closeout evidence

- Implementation commit: `a7ac6ac403e1b01f7e7bc5e8610c44f6a83eea8c`.
- GitHub Actions run `41402806377`: 191 Node tests passed, zero failed; production dependency audit reported zero vulnerabilities; Android `testDebugUnitTest assembleDebug` passed; APK verification and upload passed.
- Debug APK artifact: `jarvis-companion-debug`, artifact ID `13122630893`, SHA-256 `dc9ab74e60cb8e831e884c405ab43eac6c5c103c385f2ecf797521047e99eafd`, expires 2026-11-09.
- Render deployment `dep-dbk36ttg1s2s738i9hr0` for the implementation commit is live.
- Task planning remains proposal-only. Saving a plan creates an unapproved workflow draft; validation, approval and Run remain separate explicit user actions.

## Reconciliation of historical phases

The existing repository has historical documents labelled Phase 11–23, including two different historical Phase 13 documents. They describe work completed under an earlier roadmap. They are retained for provenance. This new roadmap maps only actual functionality to the requested Phase 1–32 acceptance criteria and does not claim that the old phase numbers are equivalent.


## Phase 0 closeout evidence

- Closeout main commit: `7eb5a88a49b4984347b298c9b385ad85c6a209e8`.
- GitHub Actions run `41382218139`: both Node and Android jobs passed.
- Render service `jarvis-personal-assistant`: configured branch `main`, auto-deploy enabled, current deployment live on the closeout main SHA.
- Neon production snapshot: `snap-broad-breeze-b5vd7iie`.
- Legacy JSON/chat recovery and active Render DATABASE_URL confirmation remain explicit prerequisites before data migration; they are not claimed complete.

## Phase 15 follow-up — outcome verification

The Phase 15 integration follow-up was delivered in [PR #55](https://github.com/18110priyanshuraj-creator/Jarvis/pull/55), squash-merged to main at `8b00096ea7b62611d5275656a292d5db78c07a72` from branch `fix/phase15-outcome-verification`. It fixes the distinction between an Android accessibility API accepting an action and JARVIS observing that the requested outcome appeared.

The follow-up adds a bounded foreground-package check after app launch and a local visible-text postcondition after UI mutations. Server and on-device plan validators independently reject missing or mismatched checks. Failure to observe the expected result stops the sequence for user review. Only generic verification categories are persisted in the Android journal; visible screen text and expected phrases are not stored.

The current deterministic app-search template opens the requested app, checks its foreground identity, enters the phrase, checks that the phrase is visible, and pauses for the user to submit the search and select a result. It does not claim that search results were loaded. This is not the general browser-research capability in Phase 16.

PR CI #41451937432 and post-merge main CI #41452457643 both passed. The post-merge Node suite passed 209/209 with zero production dependency vulnerabilities; Android unit tests, debug build, APK integrity verification and artifact upload passed on the merged main SHA. This repository-level work does not replace Phase 31 physical Galaxy Tab A9 acceptance.


## Phase 19 closeout — Independent Learning

- Implementation branch: `feat/phase-19-independent-learning`.
- Explicit teaching commands: `Learn: title | lesson`, `Teach JARVIS: title | lesson`, and `Sikhao: title | lesson` (chat lessons are limited to 500 characters).
- Lessons are stored in the existing persistent Knowledge collection as user-authored notes; duplicate content is reconciled using the existing stable knowledge fingerprint without silently changing web-research review decisions.
- The offline assistant receives up to three relevant, trusted knowledge notes through existing keyword retrieval. An authenticated `POST /api/learning/preview` endpoint and Knowledge-screen preview reveal the context before relying on it.
- Validation excludes likely secrets and sensitive personal information. Unreviewed and rejected web research remain excluded from assistant context.
- This is explicit, user-directed retrieval learning—not model-weight training, automatic web ingestion, independent fact-checking, or guaranteed semantic understanding.
- Automated and physical acceptance evidence will be recorded against the implementation PR; physical Galaxy Tab A9 checks remain Phase 31.


## Phase 20 — Knowledge Manager implementation notes

- The document manager extends the existing authenticated Knowledge area; it does not replace legacy notes, saved web research, or Phase 19 explicit teaching.
- Binary files live on the server filesystem under `JARVIS_DOCUMENTS_DIR` (or `JARVIS_DATA_DIR/documents`). Metadata and bounded extracted text are stored in the existing application-state record (including Neon when configured).
- Hosted production must point one of those environment variables at a durable mounted volume. Neon stores metadata, not the uploaded binary bytes. A deploy without persistent file storage may lose attachments.
- Each file is limited to 15 MiB; the full library is capped at 120 records and 200 MiB aggregate. Uploads are rate-limited, MIME and extension must match, and a file signature is checked before storage.
- TXT, Markdown, CSV and JSON are extracted/validated for local search. PDF/image/audio/video attachments remain downloadable metadata-only objects, optionally discoverable through the owner's description. No OCR, PDF extraction or audio/video transcription is claimed.
- Every imported document begins unreviewed. Only a user-reviewed extracted text or description enters assistant context. Editing collection, tags or description resets the review state.
- Document binaries are not included in the JSON personal-data export; download managed attachments separately. Phase 31 remains the physical Android file-picker/download acceptance gate.


## Phase 20 closeout evidence

- Implementation PR: [#65 — Knowledge Manager and document library](https://github.com/18110priyanshuraj-creator/Jarvis/pull/65), squash-merged to `main` at `11351868839059a5148bb66d5ffcf97fbc20a82e`.
- CI: [GitHub Actions run 41598828117](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41598828117) completed successfully on implementation head `1ad69127297c52ab0cf07e22999dccf7f10d4a53`.
- Node: 260 tests passed, zero failed. Production dependency audit: 0 vulnerabilities.
- Android: `testDebugUnitTest assembleDebug`, APK integrity/metadata verification and artifact upload all passed.
- Verified debug APK artifact: `jarvis-companion-debug`, artifact ID `13213871772`, 23,992,550 bytes, expires 2026-11-10. This is a debug artifact, not a signed production release.
- Data boundary: binary attachments are stored on the configured server filesystem; Neon/application state stores metadata and bounded extracted text. Production must confirm the configured directory is on a durable mounted volume. The status API intentionally reports `durabilityVerified: false`; it cannot prove the hosting provider's retention policy.
- Extraction boundary: TXT/Markdown/CSV/JSON only are indexed offline. PDF/image/audio/video formats are attachment-only with metadata and optional user-authored descriptions. No OCR, PDF text extraction, image understanding, audio transcription or video transcription is included.
- Phase 31 still owns physical Samsung Galaxy Tab A9 file-picker, upload, download and lifecycle acceptance.


## Phase 21 closeout — Self-Evolving Skill Crucible

- Implementation PR: [#69 — Self-Evolving Skill Crucible](https://github.com/18110priyanshuraj-creator/Jarvis/pull/69), merged to `main` at `0c6c01b617d2f3c6e7ac24adba3813ccfad34ce3`.
- CI: [GitHub Actions run 41601724924](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41601724924) completed successfully.
- Node: 269 tests passed, zero failed; production dependency audit: 0 vulnerabilities.
- Android Companion build, APK integrity verification and debug artifact upload passed. Artifact: `jarvis-companion-debug`, ID `13214961180`, expires 2026-11-10.
- Runtime is a four-operation allow-listed DSL only: normalize input, extract bounded keywords, match phrases, and format output. No dynamic code, shell, filesystem, network, Android actions or integration side effects.
- Programs are linked to an approved skill version. Positive and negative tests, hash integrity, trigger/application scope and explicit approval are checked before manual execution.
- Physical Samsung Galaxy Tab A9 acceptance remains Phase 31.

## Phase 22 — Proactive Auto-Heal implementation notes

- Adds bounded incident capture from failed workflow runs, plus a manual scan of saved workflow history. Incident records contain sanitized failure categories and bounded metadata rather than raw provider exception details.
- The repair surface is intentionally limited to workflow-step timeout (10–120 seconds) and the manual retry cap (1–3 attempts). The only generated proposal increases timeout by 15 seconds and cannot exceed 120 seconds.
- A proposal is tested against an exact configuration schema before it can be approved. Applying requires explicit confirmation and a matching state revision; competing stale proposals are invalidated.
- Every applied change records before/after values and a revision. Rollback requires explicit confirmation and succeeds only if the runtime configuration has not changed since that proposal was applied.
- Runtime configuration controls the workflow runner timeout and manual retry attempt ceiling. Automatic retries, automatic repair, source-code changes, secret/storage-path changes and external actions remain disabled.
- Authenticated dashboard workspace exposes incidents, proposal validation, apply, rollback and change history. CI/API checks verify auth, failure capture and rejection of unsupported repair proposals.
- Repository/automated acceptance only; physical device acceptance remains Phase 31.
