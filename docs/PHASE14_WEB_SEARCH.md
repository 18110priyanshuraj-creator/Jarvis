# Phase 14 — Provider-Independent Web Search

## Goal

Remove the legacy Google grounded-search path and add live search through a trusted, server-configured SearXNG JSON endpoint. Use the optional Phase 13 AI provider only for answer synthesis.

## Search flow

1. The authenticated chat/research endpoint receives a text query; it never accepts a search URL or outbound headers from the browser.
2. Query safety screening runs before any network request.
3. The server calls the configured SearXNG `/search` JSON endpoint with general search, SafeSearch level 2 and the configured language.
4. The adapter bounds timeouts/retries/response size/result count, blocks redirects, and accepts only unique HTTPS source URLs.
5. If the Phase 13 AI provider is ready, it summarizes the snippets and cites only numbered sources supplied to it. Otherwise JARVIS returns a labelled list of search-result snippets.
6. Search results are not saved to memory or Knowledge automatically. The existing Save Research / Save to Knowledge actions remain explicit.

## Configuration

- `JARVIS_SEARCH_BASE_URL`: trusted SearXNG instance base URL.
- `JARVIS_SEARCH_API_KEY`: optional bearer token for a protected instance.
- `JARVIS_SEARCH_ENABLED=true`: explicit enable switch.
- `JARVIS_SEARCH_TIMEOUT_MS`: bounded to 3–30 seconds.
- `JARVIS_SEARCH_RETRY_ATTEMPTS`: bounded to 1–3.
- `JARVIS_SEARCH_MAX_RESULTS`: bounded to 3–10.
- `JARVIS_SEARCH_LANGUAGE`: a validated language tag or `all`.

Remote production endpoints must use HTTPS. Loopback HTTP is allowed only in non-production environments. The configured endpoint comes only from server environment variables. The client cannot choose it.

## Safety and privacy

- Reject unsafe queries before outbound network activity.
- Use SafeSearch 2 and general results.
- Treat result titles/snippets as untrusted prompt-injection material.
- Only HTTPS result links are returned or saved. Redirects from the search service are rejected.
- Keep API credentials server-side and never include them in health output or logs.
- This phase indexes search results and snippets only; it does not fetch full pages, crawl links, auto-save results, or train model weights.

## Verification

Tests cover provider readiness, HTTPS/loopback policy, source normalization, SafeSearch request parameters, response-size and malformed-result handling, retry-safe errors, citation mapping, unsafe-query blocking, and existing API auth/rate-limit behavior.
