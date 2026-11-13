# JARVIS Creator Copilot and Media Studio

This feature extends the existing Media Studio with a right-docked, collapsible editing assistant. It is designed after the attached AutoEdit-style editor reference: keep the timeline and preview visible while the assistant is open, then hide the panel without leaving the edit.

## Creator Command Deck

Open **Media Studio** to see the Creator Command Deck. Its cards link to the existing workspaces:

- Video Editor: storyboard, preview, multi-track timeline and local export.
- Campaign Studio: short-video outline, carousels, scripts, social drafts and asset pack.
- Trend Radar and SEO: opt-in recent-source research and SEO-page drafts.
- Thumbnail and Characters: thumbnail canvas and reusable stick-figure poses.
- Research Desk, Android Control and Voice Assistant.

The cards are shortcuts to existing modules, not claims that each provider integration is already connected. Project, draft, scene and duration counters come from the Media Studio project list.

## Open the side panel

1. Sign in to the JARVIS dashboard and open **Media Studio**.
2. Create a storyboard or open an existing project.
3. Attach a video to a Video track using **Add media**.
4. Open the JARVIS **side panel** toggle in the editor header.
5. Select the video clip in the timeline. The copilot context updates to the selected clip and scene.
6. Use **Smart edit check**, **Improve selected scene**, or ask a question.

On smaller screens the side panel becomes a bottom drawer. The editor remains the main workspace; hide the drawer to get the full width back.

## Analyze selected video

1. Select an attached video clip in the timeline.
2. Open the JARVIS side panel.
3. Press **Analyze selected video frames**.
4. JARVIS samples up to four still frames in the browser and sends those small preview images plus project text to the configured AI service.
5. Review the time-coded visual findings and edit suggestions.

The original video is not uploaded or stored by this endpoint. The visual review can comment on sampled framing, title readability, visible continuity and repeated-looking shots. It cannot inspect motion between the four frames, hear dialogue, verify acting, or detect a repeated spoken take from still images alone. The model is told not to claim otherwise.

## Scan audio pauses locally

1. Add an audio file to an Audio track.
2. Select that audio clip.
3. Press **Scan selected audio for long pauses**.
4. JARVIS decodes supported audio locally in the browser and lists sustained low-volume intervals.

Limits: local scan is capped at 25 MiB and ten minutes, depending on browser codec support. It reports signal-level low-volume candidates, not confirmed silence, missed speech or bad takes. It does not cut the audio or move video clips automatically. Review the markers before trimming with the timeline controls. Audio bytes are not sent to the server.

## AI scene rewrite

The copilot can prepare a selected-scene rewrite. It appears in an editable proposal with heading, voiceover, on-screen text and visual direction. Nothing changes until **Apply to draft** is pressed. Then use **Save changes** to persist the edit. Approval and export are separate actions; the copilot never publishes a video.

## Provider and privacy requirements

- The server must have JARVIS AI enabled and JARVIS_AI_CHAT_ENABLED=true.
- Gemini OpenAI-compatible deployments can use the configured numbered key failover.
- Text-only copilot requests send project text metadata and the question.
- Video visual review sends only up to four downscaled still frames and project metadata, after the user presses Analyze.
- Audio pause scanning is local; only resulting time intervals may be included with a later, explicit visual-review request.
- Media analysis responses are not saved as project content automatically.

## Available now vs. not yet implemented

Available in the project: storyboard editor, multi-track timeline, preview, trim/split/keyframe and speed controls, colour grading, local assets, SRT/JSON/script export, local video render, Creator Campaign Pack, thumbnail and stick-figure tools, Android Companion UI control, and reviewed YouTube publishing.

New in this branch: right-docked side panel, context-aware text copilot, local project-quality audit, four-frame AI visual review, local low-volume audio scan and Creator Command Deck.

Not yet available: full-motion/whole-video AI analysis, word-level speech transcription, diarized speaker/take detection, reliable bad-take identification, automatic repeated-speech removal, or a synchronized one-click silence-removal/ripple-edit operation. Those need a proper transcription/audio-analysis pipeline and additional synchronized timeline-edit tests. Do not treat a low-volume interval as proof that speech should be removed.

Deployment status is separate from code status. These changes remain on the feature branch until the PR is merged and the connected hosting service deploys that commit.