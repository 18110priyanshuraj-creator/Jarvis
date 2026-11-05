# JARVIS creator-suite mapping from the supplied Hermes Agent video

This note maps the visible feature ideas in the supplied 91-second vertical video to the JARVIS capabilities that already exist and the additions on `feature/hermes-inspired-creator-suite`.

The video presents ten creator skills. This is a feature mapping, not a claim that the video demonstrates working source code for every item.

## Ten creator skills

| Video feature | JARVIS implementation | Status / boundary |
| --- | --- | --- |
| 1. Faceless video | Creator Campaign Pack produces a short-video hook, 2–6 narrated scenes, on-screen text and visual prompts. Media Studio renders storyboards, motion graphics, audio tracks and exports. | Draft and rendering workflow exists. User reviews assets, rights, narration and final export. |
| 2. Voice assistant | Existing JARVIS voice interface and Android Companion. | Existing capability; device permissions remain user-controlled. |
| 3. Docs to Reel | Campaign brief accepts pasted notes from reviewed documents and turns them into a Reel/Short storyboard. The Knowledge Library already stores supported documents. | Pasted/reviewed text is supported. PDF and image OCR/transcription are not implemented by this workflow; metadata-only document uploads are not treated as extracted source text. |
| 4. Carousels | Campaign Pack creates 4–8 slide copy and visual prompts, plus caption and comment CTA. The asset ZIP includes individual 1080×1080 brand-kit-aware SVG slides. | Editable vector design drafts; review copy and rights. Not automatically posted. |
| 5. SEO pages | Campaign Pack creates a slug, meta title/description, H1, section outline and FAQs. | SEO content draft; it does not publish a website page or guarantee rankings. |
| 6. Trend Radar | Optional live research uses the configured SearXNG endpoint with a 24-hour `time_range=day` filter and displays returned source links. | Requires live-search configuration. If search fails, the UI reports unavailable instead of inventing trends. |
| 7. Video editor | Existing Media Studio has a multi-track timeline, overlays, audio tracks, transitions, keyframes, speed ramps, local preview and export. Campaign scenes can be handed into it as a new vertical draft. The asset ZIP adds a timed storyboard CSV, SRT/VTT caption tracks, YouTube chapter timestamps when the clip is long enough, a 1080×1920 Reel/Short cover template and a 1280×720 YouTube thumbnail template. | Timeline editing/rendering is local. Cover files are editable SVG starting layouts with visual placeholders, not rendered footage. Canva's own mobile timeline is not assumed to be fully automatable. |
| 8. Auto posting | Existing YouTube publication path uses an exact preview, rights/audience review and explicit upload confirmation. Instagram/Facebook captions are included in Campaign Pack. | No background or cross-platform auto-posting was added. External publishing remains explicitly reviewed. |
| 9. Lead Machine | Campaign Pack produces a lead-magnet outline, optional comment keyword, public reply draft and manual resource-reply draft. | Consent-based copy templates only. No profile scraping, contact harvesting, bulk DM, automated outreach or collection of private contact details. |
| 10. Idea Engine | Campaign Pack supplies follow-up topic ideas; existing research and Creator Studio support planning. | Ideas are drafts, not performance predictions. |

## Downloadable campaign assets

The authenticated Creator Studio ZIP export groups the campaign brief, SEO HTML draft, platform copy, idea backlog, lead-resource outline, Trend Radar source-review checklist, human pre-publish checklist, carousel SVGs, video storyboard and caption tracks. The cover templates are SVG layout files; users replace the play/visual placeholders with original footage or licensed artwork. Subtitle timing is scene-based and must be checked against the recorded voiceover. YouTube chapter output is withheld when the scene plan cannot satisfy the chapter minimums.

## Useful Hermes Agent architectural ideas

The reference repository was reviewed for its documented patterns. JARVIS already has corresponding native systems, so this branch connects features rather than copying a second agent runtime:

- Skills and bundles → versioned JARVIS Skills with validation and explicit approval.
- Persistent memory → JARVIS Memory and Knowledge Library with privacy checks.
- Scheduled work → JARVIS scheduler and reviewed workflows.
- Delegation → JARVIS specialist workers and bounded worker runs.
- Tool guardrails → explicit approvals, rate limits, safe-failure paths and execution verification.

No Hermes Agent runtime or third-party source files are vendored by this feature branch.

## Campaign API

- `GET /api/creator/campaigns` — list saved campaign drafts.
- `POST /api/creator/campaigns` — build and save a draft from a topic, audience, language and optional source notes.
- `DELETE /api/creator/campaigns/:id` — delete a draft.
- `POST /api/creator/campaigns/:id/media-project` — create a vertical Media Studio draft from the campaign's short-video scenes.

Trend Radar is opt-in. Campaign generation is rate-limited and authenticated. All generated sections are bounded and normalized before storage. Drafts never trigger external publishing actions.
