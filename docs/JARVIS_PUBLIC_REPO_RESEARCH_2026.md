# JARVIS public repository research — November 2026

## Scope and approach

This is a targeted architecture and license review, not a claim that 10,000 repositories were individually audited. JARVIS was inspected on `main`, its existing feature-harvest notes were read, and public repositories were compared by the capability gap they could close. Existing implementations are preferred over importing duplicate editors or whole competing agent runtimes.

## JARVIS capabilities already present

The current source includes a browser Media Studio with:
- Vertical short (up to 90 seconds), landscape explainer (up to 180 seconds), square carousel (up to 60 seconds), and long-form projects (up to 20 minutes).
- Multi-track video, overlay and audio timeline support; bounded timeline normalization (up to 8 tracks and 160 clips).
- Clip trimming/splitting, keyframes, speed ramps, chroma key, masks, transitions, camera movement and colour grading.
- Browser-local image/video/audio assets, local preview, voiceover/music mixing and browser-rendered export.
- Creator Studio storyboards, campaign packs, captions/script exports, and an explicitly reviewed YouTube publishing flow.
- Android app control and Canva Accessibility actions using exact visible controls and user-controlled checkpoints.

The renderer is still browser-local and MediaRecorder-based. A long-form project can be planned and edited, but rendering is real-time in the browser and requires the page to remain open. This does not equal a dedicated, resumable, server-side FFmpeg render farm.

## Public projects reviewed

### 1. MakeMyClip Editor — MIT

Repository: https://github.com/MakeMyClip/editor

Useful ideas:
- Local word-level transcription with whisper.cpp.
- Transcript-driven word-range cuts and repeated-take removal.
- Silence removal with a dry-run option.
- Word-timed captions and a cut-check step that flags possible clipped words.
- Non-destructive edit operations with undo/redo and timeline snapshots.
- Exports to MP4 and interchange formats for Final Cut Pro, DaVinci Resolve and Premiere Pro.

Decision:
- Do not replace JARVIS Media Studio with this editor. JARVIS already owns a browser timeline and data model.
- Evaluate its transcript/cut/caption operations as a separate, optional local media-worker capability.
- Do not install its bundled FFmpeg binary blindly. The source is MIT, but its README documents separate FFmpeg binary licensing, including GPLv3 builds on several platforms. Any packaged binary needs an explicit distribution/license review.
- Its README describes a local machine workflow; it is not automatically a fit for the Render-hosted JARVIS server or an Android tablet.

### 2. FFmpeg Skill — MIT

Repository: https://github.com/kajisho5/ffmpeg-skill

Useful ideas:
- Probe source media before selecting codecs, dimensions, frame rate or export settings.
- Use typed tool contracts rather than accepting arbitrary shell/filter-graph strings.
- Verify output metadata after rendering; inspect frame contact sheets when visual changes are involved.
- Structured tools for trims, captions, reframing, loudness, audio cleanup and platform exports.

Decision:
- Adopt the probe → render → verify pattern in JARVIS.
- Keep all media arguments typed, bounded and allow-listed. Do not pass user/model-authored shell strings to a process.
- Treat FFmpeg as an optional worker dependency, not a new mandatory Render dependency.

### 3. FireRed OpenStoryline — Apache-2.0

Repository: https://github.com/FireRedTeam/FireRed-OpenStoryline

Useful ideas:
- Translate a creative brief into a reviewable edit plan.
- Reusable style skills and human-in-the-loop approval.
- Separate planning from media tool execution.

Decision:
- Reuse the architecture pattern, not a second orchestration stack. JARVIS already has specialist workers, workflow approvals and a Media Studio project model.

### 4. Docling — MIT

Repository: https://github.com/docling-project/docling

Useful ideas:
- Document extraction and OCR for supported files.
- Audio transcription and video parsing with representative keyframes.
- Local CLI/API/MCP integration options.

Decision:
- Strong candidate for the unfinished Advanced File Management phase.
- Run it as an optional isolated worker/service with strict file-size, CPU, memory and time limits. It is a Python-based stack with optional OCR/ASR dependencies and should not be added to the main Node deployment without a deployment/compute review.
- User uploads must remain private; extracted content should be review-gated before it becomes assistant knowledge.

### 5. Browser Use — MIT

Repository: https://github.com/browser-use/browser-use

Useful ideas:
- Agent-driven browser observation and interaction.
- Browser tasks can be separated into observable steps with structured results.

Decision:
- Evaluate as a separately permissioned browser worker. Do not replace JARVIS's existing browser or Android controls.
- Preserve the current allow-list, visible-page verification, user checkpoints and prohibition on credential/OTP entry or bypassing security challenges.
- The project's optional hosted-browser services are distinct from the MIT-licensed open-source library; review privacy and costs before choosing either.

### 6. OpenChatCut — AGPL-3.0

Repository: https://github.com/0xsline/OpenChatCut

Useful ideas:
- Agent-native editable timelines and local-first media projects.

Decision:
- Do not copy or vendor code into JARVIS without an explicit AGPL compliance decision. JARVIS already has its own timeline implementation, so architectural inspiration is sufficient.

### 7. Curated discovery lists

- https://github.com/Thedurancode/awesome-ai-video-tools — a curated list of video editing, transcription, subtitle, understanding and streaming tools.
- https://github.com/sasateguh/awesome-ai-video-for-creators — a creator-focused list with editing, clipping, captions, dubbing and rendering projects.

These lists are useful discovery indexes, not evidence that every project is maintained, secure, compatible or correctly licensed. Each candidate still needs a repository-level code, activity, dependency, license and security review.

## Priority order for JARVIS

| Priority | Improvement | Why it matters | Main boundary |
|---|---|---|---|
| P0 | Export verification | Detect empty, truncated or wrong-size output before claiming success | Browser metadata check is a quality signal, not a full perceptual QA |
| P1 | Transcript ingestion and word-timed captions | Enables cut-by-text, captions and searchable media | Optional local transcription worker; model/runtime required |
| P1 | Silence and repeated-take suggestions | Reduces manual editing on talking-head content | Suggest cuts first; user reviews before applying |
| P1 | FFmpeg local-worker bridge | Enables resumable jobs and formats beyond browser MediaRecorder | Requires an installed local worker or separately hosted media service |
| P2 | Interchange project export | Lets users continue in desktop editors | Validate each format against real target applications |
| P2 | Docling-powered file extraction | Makes PDF, image, audio and video sources searchable | Isolated worker, resource limits, review status |
| P2 | Browser agent worker | Extends automation beyond Android apps | Exact permissions, visible outcome checks and explicit confirmation |
| P3 | Render queue, retries and resumable uploads | Needed for long or large exports | Durable object storage and a worker queue; not in-memory browser state |

## What this research does not justify

- Copying thousands of repositories wholesale.
- Replacing JARVIS's current editor with another full product.
- Pulling in AGPL/GPL or platform-restricted source without a license decision.
- Claiming auto-editing, transcript cutting, transcription, scene detection, or cloud rendering before those operations exist and pass tests.
- Automatically publishing videos, selecting account credentials, bypassing verification, or running external actions without the owner's approval.

## Implementation in this branch

- Added a browser media-export metadata quality check for file size, MIME type, dimensions and duration.
- Added unit tests for successful verification and common invalid-output cases.
- Kept the check separate from the existing media timeline and did not add a third-party editing dependency.
