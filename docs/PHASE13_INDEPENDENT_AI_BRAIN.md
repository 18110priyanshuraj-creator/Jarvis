# Phase 13 — Independent AI Brain

## Goal

Move general JARVIS chat and Android request planning away from the Google model SDK and onto one server-configured, provider-neutral OpenAI-compatible chat-completions interface.

## Architecture

- `services/ai-provider.js` owns endpoint validation, environment configuration, bounded timeout/retries, request construction and response normalization.
- `services/conversation.js` sends bounded standard `system`, `user` and `assistant` messages through the adapter.
- `services/agent-planner.js` requests JSON-mode output, then validates every proposed action through the existing local allow-list. The model never performs a device action itself.
- `server.js` reports safe AI readiness metadata without returning the endpoint, API key or model identifier.
- The provider URL, API key, model and opt-in flags are read only from server environment variables. They are not accepted from browser request bodies.

## Environment

- `JARVIS_AI_BASE_URL`: HTTPS base URL before `/chat/completions`.
- `JARVIS_AI_API_KEY`: required for remote endpoints. Never commit it.
- `JARVIS_AI_MODEL`: model identifier supported by the configured endpoint.
- `JARVIS_AI_ENABLED=true`: global server-side opt-in.
- `JARVIS_AI_CHAT_ENABLED=true`: separately enables online chat.
- `JARVIS_AI_PLANNER_ENABLED=true`: separately enables AI-assisted Android request planning.
- `JARVIS_AI_REQUEST_TIMEOUT_MS`: bounded to 5–60 seconds.
- `JARVIS_AI_RETRY_ATTEMPTS`: bounded to 1–3 attempts.

Production endpoints must use HTTPS and an API key. HTTP is accepted only for loopback localhost during development/test. Redirects are rejected. Provider response bodies and credentials are not exposed in user-facing errors or health responses.

## Explicit scope boundary

Phase 13 does not implement internet search, browser crawling, or automatic knowledge ingestion. Those remain Phase 14–17 work. The temporary grounded-search module remains separate until Phase 14. Saved memories and Knowledge Library entries remain user-controlled context; they do not train model weights.

## Verification

Automated tests cover missing/invalid configuration, production HTTPS/key requirements, standard chat request formatting, JSON response mode, bounded transient retry behavior, error sanitization, and response normalization. CI also runs the existing complete Node suite, dependency audit and Android Companion build.
