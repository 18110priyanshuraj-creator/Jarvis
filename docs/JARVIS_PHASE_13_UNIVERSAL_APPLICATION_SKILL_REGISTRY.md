# JARVIS Phase 13 — Universal Application Skill Registry

**Status:** IN_PROGRESS — implementation and automated acceptance are being completed on the Phase 13 feature branch.  
**Branch:** `feat/phase-13-universal-application-skill-registry`  
**Base:** `1f177872cc2914353eaa08835d06142fd3e57c0a`

## Goal

Provide one versioned instruction/trigger registry whose approved entries can be applied selectively to the JARVIS application surface handling a request. This is a static guidance registry, not an executable plugin system.

## Scope delivered in this phase

- Every skill version stores an `applicationIds` scope, with at most 12 targets per version.
- Supported built-in surfaces are `web-dashboard` and `android-companion`. Stable, normalized application/package IDs such as `com.android.chrome` may be supplied for future authenticated JARVIS integrations.
- The explicit `*` target applies to every connected JARVIS surface. Existing/legacy records without a target list migrate to `*` so prior behavior is preserved.
- A new version inherits the previous scope unless the user explicitly selects a different scope. The prior approved version remains active until the new version is independently validated and approved.
- Context matching filters by both the explicit trigger and the trusted application surface. Specific application matches are ordered before global matches.
- The dashboard exposes application targets in the Skills editor and saved-skill cards.
- Dashboard chat is bound to `web-dashboard` by server validation; it rejects attempts to claim another application ID. Paired Android voice requests are assigned `android-companion` on the server after device-token authentication, so a request body cannot select or spoof the Android surface.
- `GET /api/skills` includes the known-surface catalog and limits.
- Authenticated `POST /api/skills/preview` previews approved static matches without changing state or executing a skill.

## API contract

- `GET /api/skills`: saved skills, `applicationCatalog`, and `limits`.
- `POST /api/skills`: create a draft; `applicationIds` is optional and omitted values default to global scope for compatibility.
- `PATCH /api/skills/:id`: create a new draft version; an omitted scope preserves the current scope.
- `POST /api/skills/preview`: body contains `message` and optional `applicationId` (defaults to `web-dashboard`); returns `matches`, `total`, and `mode: static-trigger-preview`.
- Existing validate, approve, pause, version-history, delete, and chat routes retain their existing lifecycle and authorization.

## Safety and compatibility boundaries

- Skill content remains bounded static text. No JavaScript, shell, terminal, browser scripts, arbitrary gestures, or application automation code is stored or executed.
- A match only supplies optional context to configured AI conversation; it cannot override system or safety instructions, grant permissions, or authorize an external action.
- A skill is not activated on creation or edit. Passing positive and negative trigger tests plus explicit approval are still required.
- Invalid application IDs and empty explicit target lists are rejected. Malformed persisted scopes fail closed instead of widening to global.
- Old records without application scopes retain global behavior. Paused skills remain inactive. The prior active version remains active during a pending update.
- The dashboard chat route accepts only its fixed `web-dashboard` identity. The Android surface identity is derived only from the authenticated paired-device route. The preview endpoint accepts a requested ID solely to display a read-only match preview; it does not authenticate an application or grant it capabilities.

## Automated acceptance

The Phase 13 test additions cover:
- Legacy/global scope migration and backward compatibility.
- Application ID normalization and invalid identifier rejection.
- Exact application scoping, explicit wildcard behavior, and future package IDs.
- Empty/invalid/excessive scopes failing closed.
- Version edits preserving scope by default and switching scope only in a new draft version.
- Authenticated API catalog, static match preview, invalid preview IDs, app-only preview results, dashboard identity spoof rejection, and chat ID validation.
- The existing skill draft, static validation, approval, pause, and version-history regression suite.

The repository CI workflow is the acceptance source for Node syntax/tests/dependency audit and Android unit/build/APK verification. Physical Galaxy Tab A9 observations remain part of Phase 31; no hardware acceptance is claimed here.

## Closeout record

- PR: pending
- Merge commit: pending
- Main CI run: pending
- Final artifact: pending
