# JARVIS Phase 16 — Internet and Google Research

**Status:** IN_PROGRESS — server-side source-research pipeline exists; bounded Android Google browser handoff is implemented on a review branch. Full Phase 16 acceptance is not yet met.  
**Branch:** `feat/phase-16-public-browser-research`  
**Base:** `ff87b01eda4501c0b9f0b863639c4811f99ef2e2`

## Objective

Provide useful public-web research without making a paid search API or external AI model mandatory, while retaining the existing authenticated JARVIS research pipeline and safe page reader.

## Existing repository capabilities retained

The existing server-side research stack is not replaced:

- `services/web-research.js` queries a server-configured SearXNG JSON endpoint. It enforces HTTPS for remote endpoints, SafeSearch level 2, query screening, bounded timeouts/retries/response size/results, unique HTTPS source links, and an honest search-snippet fallback when optional AI synthesis is unavailable.
- `services/web-page-reader.js` retrieves only selected, session-token-authorized public HTTPS pages. It pins validated public IPv4 addresses, rejects redirects, credentials, private/reserved hosts, compressed responses and non-text content, and bounds request time, bytes and extracted characters.
- `services/source-answer.js` reads two to five distinct session-bound sources, requires at least two successful page reads, checks source references returned by optional synthesis, and maps citations to the exact selected HTTPS sources.
- Authenticated routes remain `POST /api/research`, `POST /api/research/read` and `POST /api/research/answer`. Results can be explicitly saved through the existing Research / Knowledge workflow; search or reading does not silently create durable memory.

## New Android browser handoff

The review-branch change adds a narrow, deterministic action for explicit public Google searches.

Supported intent examples include:

- `Search latest AI research on Google`
- `Google par JEE Main 2027 notification search karo`
- `Google pe latest AI technology research karo`

The validated plan is exactly:

1. `open_web_search` — create a fixed `https://www.google.com/search?q=...` URI from the query and open it with Android's `ACTION_VIEW` / `BROWSABLE` intent.
2. `verify_browser_foreground` — check on-device that the package holding Android's default-browser role is the foreground accessibility window.
3. `ask_user` — pause so the user can inspect the page and choose a public result.

The server-side plan validator and Android `AgentPlanRunner` independently require the browser verification to immediately follow the matching search action and carry the same query. The Android executor does not accept a browser URL from a model or user; it builds the Google HTTPS URL itself.

The Android manifest declares visibility for HTTPS BROWSABLE handlers. On Android versions with `RoleManager`, verification uses the Android default-browser role. If no unique default browser is configured, the Accessibility window is unavailable, or the expected browser is not foregrounded, execution stops for user review. JARVIS does not choose an app in the system chooser.

The local task journal stores only generic action categories (`open web search`, `verify browser`, `ask user`). It does not persist the search text or URL.

## Explicit boundaries

- A successful browser-foreground check proves only that the default browser package is foregrounded. It does **not** prove that Google finished loading, the query is visible, search results are accurate, or a source page was read.
- Result selection remains manual. The handoff does not click search results, submit forms, send messages, purchase items, or publish content.
- Login, account selection, consent and CAPTCHA challenges remain user-controlled. JARVIS pauses rather than bypassing them.
- The external Google browser handoff does not pass arbitrary Google result URLs into the secure server reader. That reader intentionally accepts only short-lived source tokens issued by JARVIS's own live SearXNG search flow. A user-selected Google URL cannot be injected into the page reader.
- The SearXNG endpoint is not bundled into the APK. Live server research is enabled only when an owner-configured trusted endpoint is present. A protected SearXNG instance may use its optional server-side key; the Android browser handoff itself needs no search API key.
- Optional AI synthesis still depends on the separately configured provider. Search-result snippets and extracted pages remain available without claiming an AI-generated source comparison when no provider is configured.
- Physical Samsung Galaxy Tab A9 browser handoff and default-browser role behavior are not claimed until Phase 31 device testing.

## Security and privacy

- Search plans accept a short query, not an arbitrary URL or outbound HTTP header.
- Queries matching the repository's restricted categories or secret-like text are rejected by the server-side planner and the Android validator/executor.
- Google is opened only over HTTPS using a fixed host and query parameter encoding.
- Browser and screen observation stays on-device. This feature does not upload accessibility text or screenshots.
- Browser handoff, browser verification and pause states are recorded only as generic action categories.
- Existing login, source-token, SSRF, redirect, SafeSearch and API rate-limit boundaries remain unchanged.

## Implementation checklist

- [x] Audit existing SearXNG search, page reader, source-answer and Research UI.
- [x] Preserve the existing token-bound safe page-reader and source-answer path.
- [x] Add deterministic English/Hindi/Hinglish Google query patterns.
- [x] Add fixed HTTPS Google search intent; never accept an arbitrary URL.
- [x] Add a distinct default-browser foreground verification action.
- [x] Require matching browser verification in server and Android validators.
- [x] Stop when no default browser/accessibility window is available.
- [x] Add generic privacy-minimized browser action journal category.
- [x] Add regression tests for local intent parsing, restricted queries, browser-check pairing and journal categories.
- [ ] Pass current PR Node syntax/tests and production dependency audit.
- [ ] Pass current PR Android unit tests, debug build and APK integrity checks.
- [ ] Merge verified implementation into `main` and verify post-merge CI.
- [ ] Verify live SearXNG configuration and service readiness without exposing secrets.
- [ ] Add a supported user-reviewed bridge from selected browser sources into the token-bound JARVIS research reader, without accepting arbitrary URLs or weakening SSRF protections.
- [ ] Test default-browser handoff on the physical Samsung Galaxy Tab A9 (Phase 31).

## Acceptance status

**Partial only.** The safe Android browser handoff and the existing server-side source-research stack are present in source. Full Phase 16 is not complete because the current Google handoff does not retrieve or compare the manually selected result, live SearXNG service configuration has not been proven available in this repository audit, and physical-device acceptance remains open.
