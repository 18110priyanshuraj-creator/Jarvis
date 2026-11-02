# JARVIS Phase 2 — Unified All-in-One Android Application Shell

**Status:** IN PROGRESS — first integration increment
**Target:** Existing Android package `com.priyanshuraj.jarviscompanion`
**Baseline:** Phase 1 code-complete native orb home

## Objective

Keep the native JARVIS orb as the Android launch screen, then expose the existing private JARVIS workspace inside the same Android application. Reuse the current browser workspace and authenticated Node/Express API rather than creating a second set of Chat, Memory, Tasks, Research, Knowledge, Workflow, Connections or System Status implementations.

## Implemented in this increment

- Add a Workspace action to the native orb home.
- Open the existing dashboard using the HTTPS server origin saved by successful device pairing.
- Keep the existing workspace password login inside the embedded page; do not pass passwords, device bearer tokens or session values through a URL.
- Provide native Home, Setup and Reload controls plus Android Back navigation for the embedded workspace.
- Keep Google-owned HTTPS hosts available for the current Google OAuth flow; other HTTPS links open in the user's external browser.
- Disable file/content access, mixed content, automatic popups and third-party cookies. Cancel certificate errors. No JavaScript bridge is registered.
- Add pure JVM tests for HTTPS base URL validation and in-app navigation allow-listing.

## Security and architecture boundaries

- Only HTTPS origins on the default secure port are accepted for the embedded workspace.
- The dashboard origin must be the server URL already stored by the current pairing flow. The app does not silently select a new service or replace the backend.
- The embedded page uses the existing single-owner login and server session behavior. The user signs in normally within the workspace.
- JavaScript and DOM storage are enabled because the existing dashboard is a JavaScript application. This does not grant native Android APIs: no `addJavascriptInterface` bridge is installed.
- File/content URL access and mixed HTTP content are disabled; SSL certificate errors are cancelled.
- Non-allowlisted HTTPS destinations leave the embedded app and open in an external browser. Insecure and unsupported schemes are blocked.
- This is an integration bridge, not a fully native rewrite. Phase 3 and later can replace individual web-backed features with native modules while retaining the same server APIs and data.

## Acceptance checks

- Existing Node.js tests and audit stay green.
- Android JVM tests include URL-policy cases for HTTPS-only configuration, origin boundaries, OAuth hosts and unsafe external links.
- Android debug APK builds and passes archive verification in CI.
- Manual Galaxy Tab A9 checks remain required: login/session persistence, rotation, WebView back behavior, Google OAuth return, external-link handoff and dashboard navigation. These checks are not inferred from CI.
