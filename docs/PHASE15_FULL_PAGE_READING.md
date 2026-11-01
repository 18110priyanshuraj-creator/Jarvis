# Phase 15 — Full-Page Reading & Research Agent

## Goal

Extend Phase 14 live search so JARVIS can retrieve and read the actual webpage behind a search result, extract readable text, optionally summarize it through the separately configured AI provider, and preserve source attribution.

## User flow

1. The user submits a live research question.
2. JARVIS searches through its server-configured SearXNG endpoint and returns normalized HTTPS sources.
3. If full-page reading is enabled, each result receives a short-lived signed read token bound to that authenticated session.
4. The user chooses **Read full page** on a source card. The browser sends the signed token and optional research question; it cannot send a URL or choose outbound HTTP headers.
5. JARVIS validates the token, resolves and validates the destination, pins the request to one verified public IPv4 address, and retrieves one page without following redirects.
6. HTML or plain text is extracted under strict byte, time and character limits. Scripts, styles, forms, embedded frames and navigation-oriented elements are removed.
7. If the Phase 13 AI provider is configured, it may produce a short source-grounded summary. Otherwise the extracted text remains available with a clear no-summary message.
8. The user may explicitly save a bounded summary to the Knowledge Library. Reading never saves automatically.

## Security controls

- Full-page reading is disabled by default. Configure `JARVIS_PAGE_READ_ENABLED=true` in the server environment.
- Tokens contain the source URL and issuance time, are HMAC-signed with the server password, are bound to the current session, expire after 15 minutes, and are not stored in the browser's persistent state.
- Only HTTPS URLs on the standard 443 port are allowed. URL credentials, localhost and private/internal domain suffixes are rejected.
- DNS lookup requests IPv4 records. Every returned address must be public; if even one returned address is private, reserved, link-local or otherwise non-public, the request is blocked.
- The HTTPS request is pinned to a validated IPv4 address while preserving hostname-based TLS verification and SNI. Redirects are rejected, reducing DNS-rebinding and redirect-based SSRF risks.
- Only `text/html`, `application/xhtml+xml` and `text/plain` are accepted. PDF, image, archive, executable and other binary formats are not read in this phase.
- Compressed responses are rejected. Timeout, response bytes and extracted characters are bounded. No cookies or authentication headers are forwarded to source websites.
- Retrieved webpage text is untrusted data, not instructions. Optional AI synthesis must ignore prompt injection and use only supplied page content. Page code is never executed.
- The service does not crawl links, submit forms, download files, auto-save, or train model weights.

## Configuration

```dotenv
JARVIS_PAGE_READ_ENABLED=false
JARVIS_PAGE_READ_TIMEOUT_MS=15000
JARVIS_PAGE_READ_MAX_BYTES=2000000
JARVIS_PAGE_READ_MAX_CHARS=30000
```

The default is off. The upper caps are 30 seconds, 2 MB and 30,000 extracted characters.

## API

- `POST /api/research/read` — authenticated endpoint. Accepts `readToken` and an optional research `question`. It never accepts a browser-supplied URL.
- `POST /api/research` — when the feature is enabled, adds signed read tokens to result sources.
- `POST /api/knowledge` — existing explicit user save path. No page content is retained without a separate user action.

## Verification

Tests cover URL validation, IP classification, token expiry and session binding, script/style removal, public-IP pinning, mixed public/private DNS rejection, redirects, unsupported MIME types, response size, empty-page errors, safe error messages and authenticated API behavior.
