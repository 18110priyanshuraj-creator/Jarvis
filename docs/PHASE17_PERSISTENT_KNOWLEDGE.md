# Phase 17 — Persistent Knowledge Learning

## Goal

Build a durable, user-controlled knowledge library that retains provenance, avoids duplicate records, and prevents unreviewed web research from silently influencing JARVIS answers. This phase improves the existing Knowledge feature and uses the existing Neon application-state store; it does not create a second database.

## Persistence

- Knowledge records remain part of the existing `jarvis_app_state.state` JSONB document in Neon PostgreSQL.
- Existing revision-aware save logic remains responsible for safe state updates and concurrent-write checks.
- Local development and tests continue to use the existing file-backed state adapter when `DATABASE_URL` is not configured.
- Existing saved knowledge is normalized on load; missing capture dates fall back to the existing creation date, and existing review decisions are retained.

## Provenance retained per entry

- Capture time, creation time and last update time.
- Source title, canonical HTTPS URL and domain.
- Available original search-result snippet.
- Source publication date when supplied by the search provider.
- Page retrieval date when available.
- Claim citations linked only to source URLs stored on the same entry.
- Stable content hash used for exact normalized duplicate detection.

URL fragments are removed when storing sources so multiple links to sections of the same page do not create duplicate provenance entries. Insecure URLs and URLs containing embedded credentials are not saved.

## User-controlled review lifecycle

Web research has three explicit states:

- `unreviewed`: saved, searchable and visible in the library, but excluded from assistant context.
- `user-reviewed`: approved by the user for use as knowledge context.
- `rejected`: retained for user inspection, but excluded from assistant context.

Manual notes remain `user-authored` and can be used as user-provided context. Marking a source as reviewed records the user's review decision; it does not claim an independent fact-check.

The Knowledge screen adds filters for all entries, reviewed/user-authored entries, entries awaiting review and rejected entries. Rejected entries can be returned to the review queue; reviewed entries can be reset to needs-review.

## Duplicate handling

- The existing normalized title/content fingerprint remains the stable exact-content duplicate key.
- A repeat save merges new unique HTTPS source links, snippets, dates, citations and tags into the existing item.
- A duplicate save keeps the existing record ID and original creation date.
- A duplicate save does not silently change a prior review decision. A rejected item remains rejected and an approved item remains approved unless the user explicitly changes its state.

## Phase 16 integration

A source-supported Phase 16 answer can be saved to Knowledge only after the user chooses **Save answer to Knowledge**. The saved item includes the answer, agreement/difference/uncertainty notes, source URLs, available excerpts, retrieval timestamps and claim-level citations. It begins in `unreviewed` state and must be reviewed before it can enter future assistant context.

No research is saved automatically, no conversation is silently converted into memory, and no model weights are trained.

## API

- `GET /api/knowledge?q=...&review=all|trusted|unreviewed|rejected` searches and filters the existing library.
- The response includes a summary of total, trusted, unreviewed and rejected records.
- `POST /api/knowledge` creates a new record or merges provenance into an exact duplicate.
- `PATCH /api/knowledge/:id` lets the owner mark web research reviewed, return it to the review queue, or reject it with an optional note.
- `DELETE /api/knowledge/:id` retains the existing explicit deletion action.

All routes remain authenticated. Existing secret-detection and HTTPS-only source validation remain enabled.

## Verification

Tests cover provenance capture, canonical source URLs, publication and retrieval dates, exact duplicate merge, preservation of an existing approval decision, exclusion of unreviewed/rejected items from assistant context, review filters and review-state transitions.
