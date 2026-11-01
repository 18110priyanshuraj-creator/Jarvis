# Phase 19 — Intelligent Conversation Memory & Context

## Goal

Improve continuity across turns without turning ordinary conversations into permanent personal records. Keep the existing selective-memory model, Neon application-state store, and temporary chat store.

## User-controlled memory lifecycle

- A note becomes durable only after an explicit Remember / Yaad rakhna request or a deliberate save in the Memory screen.
- The Memory screen supports search, category filtering, editing, deletion, and a per-note **Pause in chat / Resume in chat** control.
- Pausing does not delete or hide the note from the user's saved list. It only excludes that note from the assistant's context.
- Ordinary chat history remains separate, bounded to 32 messages per conversation and expired after one hour of inactivity in the existing runtime store.

## Relevant context retrieval

- Retrieval ranks saved notes by meaningful prompt terms, exact phrase overlap, safe word-prefix/inflection matches, and category where appropriate.
- Common English, Hinglish and Hindi filler words are ignored so generic question wording is less likely to retrieve unrelated notes.
- A relevance-overlap threshold prevents a single coincidental word from pulling unrelated notes into a prompt.
- Only enabled notes can enter assistant context. Retrieval is bounded to five notes and 1,800 characters total.
- The browser's **Preview memory context** form calls an authenticated read-only endpoint. It shows the enabled notes that would be supplied for a sample prompt and counts matching paused notes that were excluded. Preview content is not saved.
- Conversation instructions say memory is user-maintained and may be out of date. The current user message takes precedence, and the model must not infer sensitive traits or additional facts from stored notes.

## Explicit forget from chat

Supported forms:

- `Forget: [paste the exact saved note]`
- `Forget that [paste the exact saved note]`
- `Bhool jao: [paste the exact saved note]`

The server normalizes case, Unicode and whitespace and requires an exact saved-note match. It deletes only that one matched memory. An incomplete, vague, bulk or unmatched request deletes nothing and returns a clear explanation. The existing Memory screen delete control remains available and asks for confirmation.

## Privacy and persistence

- Memory content remains bounded to 500 characters and the existing 200-note limit.
- The privacy screen rejects likely credentials, contact details, medical/health details and additional sensitive personal categories. Pattern screening is a safeguard, not a complete detector.
- The existing Neon-backed `jarvis_app_state` JSONB state remains the durable store. The existing file-backed adapter remains available for local development; no second database is created.
- Temporary chat messages remain in the separate runtime chat table and are not copied into durable app state or the personal-data export.
- No model weights are trained and no web research is silently saved as personal memory.

## API

- `GET /api/memories?q=...&category=...` — search/filter saved memories.
- `POST /api/memories` — save a user-supplied memory.
- `POST /api/memories/preview` — preview relevant enabled notes and matching paused-note count for a draft prompt.
- `PATCH /api/memories/:id` — edit a note or pause/resume it for assistant context.
- `DELETE /api/memories/:id` — delete one saved note.
- Chat forget requests are parsed server-side and require an exact note match; they do not use fuzzy search.

All endpoints require the existing authenticated single-owner session. Responses that contain memory content are marked `Cache-Control: no-store` where appropriate.

## Verification

Tests cover legacy normalization and pause-state preservation, privacy filtering, Unicode/case/whitespace deduplication, relevance ranking, English and Hinglish filler handling, paused-note exclusion, preview results, exact forget parsing and matching, and context item/character limits. Full CI also runs the existing Node.js suite, dependency audit and Android Companion build.
