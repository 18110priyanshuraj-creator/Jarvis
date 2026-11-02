# JARVIS Security Audit

**Snapshot:** 2026-11-02  
**Scope:** Repository configuration and code inspection, GitHub CI evidence, Android manifest/accessibility configuration and Render service metadata.  
**Status:** **PARTIAL — baseline controls exist; production and device checks remain open.**

## 1. Controls observed

| Area | Existing control | Evidence / notes |
|---|---|---|
| Production password | Server exits in production if `JARVIS_PASSWORD` is missing | `server.js` |
| Password comparison | SHA-256 digest comparison with `crypto.timingSafeEqual` | `server.js` |
| Session cookie | HttpOnly, SameSite=Strict, production Secure flag, 12-hour max age | `server.js` |
| Login rate limiting | 8 login attempts per 15 minutes | `server.js` |
| API rate limiting | Global API limiter plus specific research, page-read, OAuth, diagnostics and action limits | `server.js` |
| HTTP security | Helmet, content security policy, no powered-by header, 1 MB JSON body limit | `server.js` |
| Request origin | Mutating API requests with an Origin header are checked against the current host | `server.js` |
| Data files | JSON state writes use a temporary file, atomic rename and mode 0600 | `server.js` |
| Database writes | Revision-checked update and merge/retry logic for Neon JSONB state | `server.js` |
| Memory privacy | Memory validation rejects credentials and a broad set of sensitive personal categories | `services/memory.js` |
| Knowledge provenance | HTTPS URL filtering, citation/source normalization and review states | `services/knowledge.js` |
| OAuth | Google authorization-code flow with PKCE, state/browser binding and AES-256-GCM encrypted refresh-token storage | `services/oauth.js` |
| External actions | Preview, expiry, explicit confirmation, allow-listed Telegram chat IDs and one-time execution | `services/external-actions.js` |
| Integrations | Fixed provider endpoints, GET-only read operations, timeouts and sanitized result summaries | `services/integrations.js` |
| Android pairing | Short-lived one-time pairing code, attempt limit, token hash on server and device revocation | `routes/devices.js` |
| Android local token | Keystore-backed encrypted local token storage | `DeviceTokenStore.kt` |
| Android transport | App rejects cleartext network traffic and device connector uses HTTPS | `AndroidManifest.xml`, `DeviceConnector.kt` |
| Android protected actions | Exact-label action matching; rejects send, submit, delete, payment, purchase and security controls | `UIActionExecutor.kt` |
| Screen data | Screen summary is local, bounded and only returned on explicit request; not sent to server or persisted by the observer | `ScreenObserver.kt` |
| CI dependency audit | Production dependency audit succeeded with 0 reported vulnerabilities on audited main commit | GitHub Actions run 41324445358 |

## 2. Material risks and open checks

### S-01 — Production data migration can discard legacy chat history

The old production server stored chat turns in `store.chats` inside `data/state.json`. Current main's `normalizeStore()` deliberately excludes that property and the load path normalizes then saves the new state. Deploying current main against the old JSON state can permanently remove those transcripts.

**Required:** back up the deployed state before migration, verify the backup, and decide whether old transcripts should be exported/archived or intentionally discarded. Do not perform a production migration before this gate is closed.

### S-02 — Storage durability is not verified

The current server uses Neon when `DATABASE_URL` is configured and otherwise stores application state in a local JSON file. The old service was JSON-file based. The current Render service is on the free plan and no persistent disk was listed in the returned service settings. The active environment values were not exposed or read, so whether Neon is currently configured cannot be asserted.

**Required:** use authenticated JARVIS System Status diagnostics to verify storage mode, then verify backup/restore and persistence after restart in a safe test environment.

### S-03 — Live production code is behind and divergent from main

The live Render deployment is commit `02e60a6969f0412373b2f2c420f589ded9933287`, not current main. The service's branch setting now says main, but the last live deploy remains old. A main deployment may change state schema, app endpoints and user-visible behavior.

**Required:** test a staging deployment and migration using a copy of production data before any live deploy.

### S-04 — Render blueprint and live settings differ

Repository `render.yaml` specifies `npm install && npm run check` and `/api/health`; Render currently reports `npm install` and an empty health-check path. The blueprint has legacy Gemini environment keys while main's app uses provider-neutral JARVIS environment names.

**Required:** reconcile names, defaults, build and health-check settings. Never copy secret values into repository files or this document.

### S-05 — Main is unprotected

GitHub reports `main` as unprotected with no required status checks. A push can therefore bypass CI policy.

**Required:** add branch protection and require the current Node and Android CI jobs after confirming the chosen merge workflow.

### S-06 — Public network reachability

Render reports an IP allow-list of `0.0.0.0/0`. The service is publicly reachable; the application relies on its login/session boundary rather than a network allow-list. Password auth, secure cookies, rate limits and same-origin checks are present, but this is still a public attack surface.

**Required:** retain strong unique credentials, monitor rate-limit events and keep dependencies patched. Do not expose secrets in diagnostics or logs.

### S-07 — Device speech privacy depends on the speech provider

The Android app requests microphone access only through user-started flows and exposes a foreground service notification. It prefers on-device recognition where Android reports support, but the active recognizer may use the installed speech service's own network/privacy behavior. Browser SpeechRecognition has similar browser/provider dependency.

**Required:** clearly label when on-device recognition is unavailable; do not claim fully offline voice on a device unless that mode is measured and verified.

### S-08 — Accessibility is powerful and intentionally limited

The accessibility service can read visible node content when enabled by the user. It does not support arbitrary gesture injection in its accessibility configuration. The UI action executor rejects protected actions, but third-party application labels and node hierarchies vary.

**Required:** keep explicit enablement, screen disclosure, bounded actions, exact-label matching, stop/cancel and manual approval for consequential tasks. Add actual tablet tests before broadening actions.

### S-09 — Generated skills are not sandboxed because they are not executable

The existing skill engine validates text, triggers and test cases. It does not run generated source code. This is a safe current limit, not a verified sandbox. Do not treat existing Skills as a self-writing/self-executing code system.

**Required:** before adding executable generated skills, design a separately constrained runner, resource limits, permission manifest, security tests and rollback.

### S-10 — Complete secret scanning not yet evidenced

The audit reviewed `.env.example`, `render.yaml` and secret-handling code paths, but did not run a full repository secret scanner against all current and historical blobs. No production secret values were requested or exposed.

**Required:** run a secret scan on the full repository history in a controlled environment and rotate any exposed credentials if findings occur.

### S-11 — Release signing and device security tests remain open

CI produces and integrity-checks a debug APK. No signed release artifact, install on the Samsung tablet, Android permission test or physical microphone/accessibility test was recorded.

**Required:** define release signing without committing signing keys, and perform device acceptance on the actual tablet.

## 3. Approval policy

Keep the existing restrictions and extend them consistently:
- Do not collect passwords, PINs, OTPs or payment credentials.
- Do not bypass Android permissions, authentication, CAPTCHAs or third-party application safeguards.
- Require explicit approval for public publishing, messaging, purchases, payments, destructive file actions and critical security changes.
- Generated code must not execute inside the privileged main application process.
- Keep task Stop/Pause/Resume/Cancel controls available and verify results before claiming completion.

## 4. Security status

Current baseline controls are meaningful and several are covered by automated tests. The system is **not yet security-verified for the requested unified Android product**. The production data migration, storage durability, branch protection, complete secret scanning, release signing and physical-device checks remain open.
