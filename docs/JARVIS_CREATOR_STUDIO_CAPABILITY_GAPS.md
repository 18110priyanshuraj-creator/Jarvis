# JARVIS Creator Studio and Media Studio — capability boundary

## Creator Studio capabilities

The current repository includes:
- A 4–20 minute, eight-chapter outline builder and narration drafting through the configured JARVIS AI provider.
- Title/hook suggestions, per-chapter visual direction, Markdown script, storyboard CSV and YouTube description exports.
- Stick-figure SVG poses and pose sheets, thumbnail layouts and campaign asset bundles.
- Creator Campaign Pack outputs for short-video scenes, carousels, SEO page drafts, idea backlogs, trend research checklists and manual lead-magnet/reply copy.
- Read-only YouTube Analytics code for top-video and audience-retention reports. A live account connection and actual report eligibility still require owner-side OAuth acceptance; thumbnail impression CTR is not included in the report.
- An explicitly previewed and confirmed YouTube publishing flow. It is not background auto-posting.

## Media Studio capabilities verified in current source

- Formats: vertical short (up to 90 seconds), landscape explainer (up to 180 seconds), square carousel (up to 60 seconds), and long-form (up to 20 minutes).
- Up to 80 scenes, 8 timeline tracks and 160 timeline clips, with server-side normalization and bounded project fields.
- Video, overlay and audio timeline tracks; clip source in/out points, trim/split, transitions, keyframes, speed ramps, chroma key, masks, camera movement and colour grading.
- Local image/video/audio assets and a browser-local IndexedDB asset library. It is not cloud-synced.
- Browser preview and local export with optional imported voiceover, background music and timeline audio mixing.
- Script, captions, project JSON, PNG frames and browser-rendered video export. The browser may select MP4 when supported; WebM is the fallback.
- Projects begin as drafts; exports require approval. The browser tab must remain open during real-time rendering. Longer renders are more practical on a desktop browser.

## Important limitations — not implemented or not yet accepted

- No native automatic speech transcription / word-level transcript editor is integrated into Media Studio.
- No automatic silence/retake detection or transcript-driven cut suggestions.
- No dedicated FFmpeg worker, resumable server-side render queue or cloud render farm.
- No verified Final Cut Pro, DaVinci Resolve or Premiere Pro interchange export.
- No automatic audio mastering chain or guaranteed loudness compliance. Imported tracks are mixed in the browser with bounded gain controls.
- No guarantee that an export is playable on every device/browser. Export metadata verification is being added, but visual/audio review remains necessary.
- No guaranteed YouTube impressions, reach, views, retention or subscriber growth.
- Canva's optional Connect integration and Android Accessibility UI path remain separate. Canva OAuth credentials are not needed merely to open the installed Canva app and use the bounded on-device controls. Arbitrary Canva timeline editing is not claimed.
- Physical Android/Canva acceptance remains dependent on testing the actual target device and installed app version.

## Recommended next steps

1. Add optional local transcription and word-timed subtitle ingestion.
2. Generate silence/retake cut suggestions with a dry-run preview and explicit approval before applying cuts.
3. Add a separately installed or hosted FFmpeg media worker with typed commands, bounded resource budgets, progress events, cancellation and durable job records.
4. Add export verification plus a frame/contact-sheet preview; retain a manual audiovisual review step.
5. Add validated interchange export only after checking real project compatibility in each target desktop editor.
6. Add an isolated document/media extraction worker for PDF, image, audio and video knowledge ingestion, with review-gated indexing.
7. Finish physical Android/Canva acceptance and signed release checks before claiming those workflows are production-ready.

## Acceptance principles

- Distinguish "requested", "started", "completed" and "verified" states.
- A successful browser recording API call is not proof of a valid final media file.
- Unsupported operations must fail honestly rather than falling back to arbitrary shell commands or coordinate-based UI actions.
- Keep uploads local unless the user has explicitly chosen an authenticated storage destination.
- Preserve draft/approval gates for edits and publishing.

## Open-source editor integration — JARVIS-native approach

JARVIS keeps its existing project model and browser timeline as the canonical editing surface. The goal is to port useful *capabilities and algorithms*, not to paste several desktop applications into the Android app.

### Capability mapping

- **Dawn Cut concepts:** retain transcript-aware editing, word-timed captions, filler/retake review, silence candidates, and deterministic edit-decision lists as target capabilities. JARVIS already has local low-volume interval scanning, SRT/WebVTT import, timeline trims/splits, and project-level visual checks. Automatic speech-to-text and word-level transcript editing are still not implemented.
- **MakeMyClip Editor concepts:** use typed edit commands, previewable operations, undo/redo snapshots, and portable timeline interchange. JARVIS already has multi-track clips, trims, splits, speed ramps, keyframes, transitions and local export. A general natural-language command-to-edit executor and durable undo/redo history remain future work.
- **OpenChatCut concepts:** preserve the multi-track timeline and agent-tool boundary. JARVIS already has multi-track editing and a bounded AI copilot. Do not copy OpenChatCut's AGPL-licensed implementation into this repository unless the project deliberately adopts and satisfies the resulting source-distribution obligations; reimplement compatible ideas independently and retain attribution for any copied permissively licensed code.
- **Rough-cut prototype concepts:** build a reviewable rough-cut proposal from transcript timing and silence candidates. Current silence scanning is local and advisory only; it does not automatically delete or move timeline media.

### Changes in this integration pass

- Long-form AI storyboard generation now asks for up to 80 concise narration-linked beats, normally 4–8 seconds each, with varied shot scale, subject, action and composition. It asks the model not to pad a short brief or claim that media assets have been generated.
- The Media Copilot audit now flags missing visual direction, adjacent repeated visual prompts and long-form scenes that may need additional cutaways.
- These checks are editorial warnings, not proof of visual quality. The user must still preview the rendered result and check narration synchronisation.

### Android and runtime boundary

The Android Companion remains the permission-gated controller for supported visible UI actions. It does not expose a private VN editor API, arbitrary coordinate tapping, or guaranteed frame-accurate control of every VN feature. The browser Media Studio can edit its own JARVIS timeline on the tablet; this is not the same as remotely controlling VN's internal timeline.

A true FFmpeg render worker, local speech-to-text model, word-level transcript editor, audio mastering, automatic asset sourcing and cross-app VN execution require separate implementations and device acceptance tests. Do not describe them as complete until they are built and verified.
