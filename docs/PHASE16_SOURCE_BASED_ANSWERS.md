# Phase 16 — Source-Based Answer System

## Goal

Turn Phase 14 search results and Phase 15 secure page reads into an answer that is explicitly grounded in the selected webpage content. The answer must preserve source attribution, identify agreement and disagreement, describe gaps, and avoid unsupported claims.

## User flow

1. The user runs a live web search from Research.
2. JARVIS displays the returned sources. Each eligible source has a short-lived read token bound to the signed-in session.
3. The user selects two to five sources and chooses **Build source-based answer**.
4. The browser sends only the question and selected read tokens to `POST /api/research/answer`. It cannot supply arbitrary page URLs or outbound request headers.
5. The server validates every token against the active session and server signing secret, then uses the Phase 15 safe reader to retrieve each selected page.
6. At least two pages must be read successfully. Redirects, private/reserved addresses, unsupported content, oversized responses and other unsafe pages remain blocked by Phase 15.
7. The configured provider-independent AI service receives bounded excerpts from the successfully read pages and must return structured claims with source numbers.
8. JARVIS validates every source number against the exact pages supplied to the model and maps valid references back to the original HTTPS URLs.
9. The user sees key findings, where sources agree, differences, uncertainties and the original pages. The user can open each exact source and inspect the extracted excerpt.

## Grounding and citation rules

- Only content extracted from the selected source pages is passed as factual evidence to the Phase 16 synthesis step.
- Each finding, agreement, difference or uncertainty must include one or more source numbers.
- Unknown, expired, foreign-session or duplicate source tokens are rejected.
- Unsupported or fabricated source numbers are discarded before the answer is returned.
- If there are no validated findings, the system reports insufficient evidence instead of filling gaps.
- If the online AI provider is not configured or fails, JARVIS returns the extracted source excerpts and clearly states that no combined answer was generated.
- Citation links are mapped on the server from validated source numbers; model output cannot choose arbitrary URLs.
- A displayed confidence value is a model assessment of evidence coverage, not an independent fact-check or guarantee of truth.

## Security and privacy

- The route requires an authenticated JARVIS session and is rate limited.
- Only Phase 15 signed read tokens are accepted; direct URLs are never accepted by this endpoint.
- Tokens remain session-bound and expire after 15 minutes.
- Page requests continue to use Phase 15 HTTPS-only validation, public IPv4 checks, DNS pinning, no redirects, text-only MIME allow-list and response limits.
- Webpage content is untrusted data. Instructions embedded in pages are not followed.
- Page text is bounded to 6,000 characters per page for AI context. Returned excerpts are bounded to 1,400 characters per page.
- No answer, page or conversation is saved automatically. Existing user-controlled Save Research and Knowledge actions remain separate.
- No model weights are trained or modified.

## API

- `POST /api/research/answer` — authenticated. Accepts a question and two to five session-bound `readTokens` from the most recent search results.
- The response includes the answer, validated findings, agreements, differences, uncertainties, source metadata, and citations mapping source numbers to HTTPS URLs.
- `GET /api/health` includes safe AI, search, page-reader and source-answer readiness metadata. It never returns provider credentials.

## Configuration

Phase 16 reuses the existing Phase 13 and Phase 15 server configuration:

- `JARVIS_AI_BASE_URL`, `JARVIS_AI_MODEL`, `JARVIS_AI_API_KEY`, `JARVIS_AI_ENABLED=true`, `JARVIS_AI_CHAT_ENABLED=true`
- `JARVIS_PAGE_READ_ENABLED=true` and the bounded Phase 15 page-reader limits
- Phase 14 live search must already be configured through `JARVIS_SEARCH_BASE_URL` and `JARVIS_SEARCH_ENABLED=true`

The code does not invent an AI provider credential or enable an untrusted search endpoint. Without those services the feature reports extraction-only or search-not-configured status.

## Verification

Tests cover session-bound and expired tokens, duplicate and invalid source selection, the two-to-five page limit, rejection when fewer than two pages can be safely read, citation URL mapping, invalid model-supplied source numbers, insufficient-evidence behavior and an honest extraction-only fallback. Server tests also cover authentication and disabled-feature readiness.
