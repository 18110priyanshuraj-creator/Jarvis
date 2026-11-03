# JARVIS Phase 19 — Independent Learning

**Status:** CODE_COMPLETE (repository scope; tablet acceptance remains Phase 31)  
**Roadmap:** Current Phase 19 of the Phase 0 + Phase 1–32 plan  
**Implementation branch:** `feat/phase-19-independent-learning`

## Goal

Give JARVIS a provider-independent way to retain and reuse small lessons that the owner deliberately teaches it. This is a transparent, human-controlled retrieval-learning loop, not autonomous model training.

## Teach JARVIS explicitly

The chat command accepts one lesson at a time:

```text
Learn: <title> | <lesson up to 500 characters>
Teach JARVIS: <title> | <lesson up to 500 characters>
Sikhao: <title> | <lesson up to 500 characters>
```

- A command is recognized only when it begins with one of these explicit prefixes. “I want to learn about …” and ordinary questions remain ordinary conversation.
- A lesson is stored as a user-authored entry in the existing Knowledge Library with `user-taught` and `independent-learning` tags.
- Titles are capped at 180 characters and chat lesson content at 500 characters. Longer notes can still be added in the Knowledge screen.
- The existing privacy/secret screen is applied before saving. A rejected, malformed, oversized or duplicate lesson is not silently truncated or promoted.
- Duplicate matching reuses the existing knowledge fingerprint. A merge preserves the existing source type and review decision; teaching a duplicate cannot silently approve previously rejected or unreviewed web research.
- Ordinary chat transcripts, assistant replies, feedback ratings and research results are never learned automatically.

## Offline retrieval and review

- The same existing `jarvis_app_state` Knowledge collection and revision-aware persistence are reused. No second database or external service is added.
- User-authored lessons and web research explicitly marked `user-reviewed` can enter assistant context. Unreviewed and rejected web research remains excluded.
- The deterministic offline assistant retrieves at most three relevant knowledge records using the existing keyword search. It can use them without a configured AI provider or network call.
- Authenticated `POST /api/learning/preview` is a read-only, no-store endpoint that previews the context the offline assistant would receive and counts matching unreviewed/rejected items that are excluded.
- The Knowledge screen exposes the same preview so the owner can inspect the retrieved notes before relying on them.

## Trust and model boundaries

- “User-reviewed” means the owner reviewed the material; it is not an independent fact-check or a guarantee that a source is accurate.
- Retrieval is keyword-based, not semantic/vector search. Weak matches and missing knowledge remain limitations; JARVIS must not fabricate an answer.
- No model weights are trained or modified. No hidden fine-tuning, automatic fact-checking, background web ingestion or automatic promotion from chats/ratings is introduced.
- New lessons are explicitly stored as user-authored material. The owner remains responsible for checking correctness, dates, safety and source quality.
- This phase does not implement broad PDF/image/audio/video ingestion or a multimodal document manager; those belong to later knowledge/file phases.

## API

- Chat `POST /api/chat`: handles explicit Learn/Teach/Sikhao commands before normal conversation.
- `POST /api/learning/preview`: authenticated read-only context preview; accepts `{ "query": "..." }`.
- Existing Knowledge APIs continue to manage search, source review, duplicate merge and deletion.

## Verification

Automated checks cover explicit-prefix parsing, malformed/oversized/sensitive input rejection, deduplication, preservation of previous review decisions, context inclusion/exclusion and retrieval preview. The standard CI workflow also runs the full Node suite, production dependency audit, Android unit tests, debug build and APK integrity verification.

Physical Samsung Galaxy Tab A9 acceptance is still recorded under Phase 31. This document does not claim on-device testing or foundation-model training.
