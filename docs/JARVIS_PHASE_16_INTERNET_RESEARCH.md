# JARVIS Phase 16 — Internet and Google Research

**Status:** CODE_COMPLETE — repository implementation and automated acceptance passed. Live deployment configuration and physical-device acceptance are separate external gates. Full Phase 16 acceptance is not yet met.  
**Merged by:** PR #57 into `main` after green Node and Android CI.  
**Verification:** PR CI run `41458827159`; post-push run `41458816638`.

## Objective

Provide useful public-web research without making a paid search API or external AI model mandatory, while retaining the existing authenticated JARVIS research pipeline and safe page reader.

## Existing repository capabilities retained

The existing server-side research stack is the canonical source-grounded research path; the Android Google browser handoff is an additional user-controlled way to open public web search. The existing stack is not replaced:

- `services/web-research.js` queries a server-configured SearXNG JSON endpoint. It enforces HTTPS for remote endpoints, SafeSearch level 2, query screening, bounded timeouts/retries/response size/results, unique HTTPS source links, and an honest search-snippet fallback when optional AI synthesis is unavailable.
- `services/web-page-reader.js` retrieves only selected, session-token-authorized public HTTPS pages. It pins validated public IPv4 addresses, rejects redirects, credentials, private/reserved hosts, compressed responses and non-text content, and bounds request time, bytes and extracted characters.
- `services/source-answer.js` reads two to five distinct session-bound sources, requires at least two successful page reads, checks source references returned by optional synthesis, and maps citations to the exact selected HTTPS sources.
- Authenticated routes remain `POST /api/research`, `POST /api/research/read` and `POST /api/research/answer`. Results can be explicitly saved through the existing Research / Knowledge workflow; search or reading does not silently create durable memory.

## New Android browser handoff

The review-branch change adds a narrow, deterministic action for explicit public Google searches. The query parser lives in the native Android `LocalCommandProcessor`; `NativeCoreRuntime.requestAgentPlan()` evaluates it before looking up remote pairing credentials. The Orb and hands-free voice service use this same runtime method, so this specific Google browser handoff can be planned without a paired server or AI API. Google itself still needs an internet connection to load public results.

Supported intent examples include:

- `Search latest AI research on Google`
- `Google par JEE Main 2027 notification search karo`
- `Google pe latest AI technology research karo`

The validated plan is exactly:

1. `open_web_search` — create a fixed `https://www.google.com/search?q=...` URI from the query and open it with Android's `ACTION_VIEW` / `BROWSABLE` intent.
2. `verify_browser_foreground` — check on-device that the package resolved for Android's default HTTPS BROWSABLE intent is the foreground accessibility window.
3. `ask_user` — pause so the user can inspect the page and choose a public result.

The server-side plan validator and Android `AgentPlanRunner` independently require the browser verification to immediately follow the matching search action and carry the same query. The Android executor does not accept a browser URL from a model or user; it builds the Google HTTPS URL itself.

The Android manifest declares visibility for HTTPS BROWSABLE handlers. Verification resolves the system's default HTTPS BROWSABLE handler through Android's PackageManager and compares it with the active accessibility-window package. If Android returns a system chooser/resolver instead of a unique browser, the Accessibility window is unavailable, or the expected browser is not foregrounded, execution stops for user review. JARVIS does not choose an app in the system chooser. The Orb and hands-free paths still show their existing plan preview and wait for explicit approval before launching the browser.

The local task journal stores only generic action categories (`open web search`, `verify browser`, `ask user`). It does not persist the search text or URL.

## Explicit boundaries

- A successful browser-foreground check proves only that the default browser package is foregrounded. It does **not** prove that Google finished loading, the query is visible, search results are accurate, or a source page was read.
- Result selection remains manual. The handoff does not click search results, submit forms, send messages, purchase items, or publish content.
- Login, account selection, consent and CAPTCHA challenges remain user-controlled. JARVIS pauses rather than bypassing them.
- The external Google browser handoff intentionally does not pass arbitrary Google result URLs into the secure server reader. That reader accepts only short-lived source tokens issued by JARVIS's own live SearXNG search flow. For source-grounded answers, use the Research screen's SearXNG results, select the returned tokenized sources, read them, and build the answer. This is a deliberate security boundary, not an unfinished URL-import feature.
- The SearXNG endpoint is not bundled into the APK. Live server research is enabled only when an owner-configured trusted endpoint is present. A protected SearXNG instance may use its optional server-side key; the Android browser handoff itself needs no search API key.
- Optional AI synthesis still depends on the separately configured provider. Search-result snippets and extracted pages remain available without claiming an AI-generated source comparison when no provider is configured.
- Physical Samsung Galaxy Tab A9 browser handoff and default HTTPS handler resolution are not claimed until Phase 31 device testing.

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
- [x] Add native deterministic English/Hindi/Hinglish Google query patterns before remote credential checks.
- [x] Add fixed HTTPS Google search intent; never accept an arbitrary URL.
- [x] Add a distinct default-browser foreground verification action.
- [x] Require matching browser verification in server and Android validators.
- [x] Stop when no default browser/accessibility window is available.
- [x] Add generic privacy-minimized browser action journal category.
- [x] Add server and Android regression tests for local intent parsing, restricted queries, browser-check pairing and journal categories.
- [x] Route native Google plan generation through the shared runtime for Orb and hands-free voice without requiring a paired server.
- [x] Pass current PR Node syntax/tests and production dependency audit (211/211 Node tests; 0 production dependency vulnerabilities).
- [x] Pass current PR Android unit tests, debug build, APK archive integrity and artifact upload.
- [x] Merge verified implementation into `main` and verify post-merge CI.
- [ ] Verify the production SearXNG endpoint is configured and healthy. This requires the owner to select the Render workspace/service before its environment can be inspected; no credentials are exposed or changed by this phase.

- [ ] Test default-browser handoff on the physical Samsung Galaxy Tab A9 (Phase 31).

## Acceptance status

**CODE_COMPLETE for repository scope.** The Android app has a deterministic, no-AI-key Google browser handoff behind the normal explicit approval gate. The Research screen retains the configured SearXNG search → signed page-read tokens → safe full-page extraction → two-to-five-source grounded answer workflow, including citations, disagreements and uncertainty handling. CI passed on PR #57 and again on the merged `main` source. The Google browser handoff does not scrape results or import arbitrary URLs by design.

External acceptance remains separate: production SearXNG endpoint health must be verified after the owner selects the intended Render workspace/service, and physical Galaxy Tab A9 behavior remains in Phase 31. No production environment variable or service was changed as part of this phase.
