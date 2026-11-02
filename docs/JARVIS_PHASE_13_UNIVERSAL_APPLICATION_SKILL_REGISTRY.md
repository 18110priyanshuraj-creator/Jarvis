# JARVIS Phase 13 — Universal Application Skill Registry

**Status:** VERIFIED — merged via PR #52 at `d149c1d`; the merged `main` tree is identical to the fully green Phase 13 PR/push CI tree.  
**Branch:** `feat/phase-13-universal-application-skill-registry`  
**Base:** `1f177872cc2914353eaa08835d06142fd3e57c0a`

## Goal

Provide one versioned instruction/trigger registry whose approved entries can be applied selectively to the JARVIS application surface handling a request. This is a static guidance registry, not an executable plugin system.

## Scope delivered in this phase

- Every skill version stores an `applicationIds` scope, with at most 12 targets per version.
- Built-in fallback surfaces are `web-dashboard` and `android-companion`. The authenticated Android companion reports its current Accessibility active-window package ID (for example, `com.android.chrome`) for application-scoped matching; up to 12 normalized application IDs are supported per version.
- The explicit `*` target applies to every connected JARVIS surface. Existing/legacy records without a target list migrate to `*` so prior behavior is preserved.
- A new version inherits the previous scope unless the user explicitly selects a different scope. The prior approved version remains active until the new version is independently validated and approved.
- Context matching filters by both the explicit trigger and the trusted application surface. Specific application matches are ordered before global matches.
- The dashboard exposes application targets in the Skills editor and saved-skill cards.
- Dashboard chat is bound to `web-dashboard` by server validation; it rejects attempts to claim another application ID. The authenticated paired Android client reports only the current Accessibility active-window package ID; the server validates it and falls back to `android-companion` when unavailable. Package IDs are optional-guidance routing metadata, not permissions or proof that an application action is authorized.
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
- The dashboard chat route accepts only its fixed `web-dashboard` identity. Android package context is read from the active Accessibility window on the paired device and accepted only on the authenticated device route; when unavailable, the server falls back to `android-companion`. This is contextual metadata, not a permission boundary. The preview endpoint accepts a requested ID solely to display a read-only match preview; it does not authenticate an application or grant it capabilities.

## Automated acceptance

The Phase 13 test additions cover:
- Legacy/global scope migration and backward compatibility.
- Android foreground package normalization, safe fallback behavior, and malformed package rejection.
- Application ID normalization and invalid identifier rejection.
- Exact application scoping, explicit wildcard behavior, and future package IDs.
- Empty/invalid/excessive scopes failing closed.
- Version edits preserving scope by default and switching scope only in a new draft version.
- Authenticated API catalog, static match preview, invalid preview IDs, app-only preview results, dashboard identity spoof rejection, and chat ID validation.
- The existing skill draft, static validation, approval, pause, and version-history regression suite.

Automated acceptance passed on the Phase 13 source tree: Node CI reported 203/203 tests and 0 production dependency vulnerabilities; Android JVM unit tests, Gradle build, APK integrity verification, release metadata and artifact upload passed in push run #41434694585 and PR run #41434702832. The merged `main` commit has the identical Git tree hash `8eabf26a4ead01630c52f8a3fa660fd9869eda9f`. Post-merge main run #41435305226 also passed its Node job (203/203, 0 vulnerabilities); its separate Android job remained in progress/stale at closeout, so it is not represented as a completed post-merge run. Physical Samsung Galaxy Tab A9 behavior remains to be checked in Phase 31; no hardware acceptance is claimed here.

## Closeout record

- PR: [#52 — merged](https://github.com/18110priyanshuraj-creator/Jarvis/pull/52)
- Merge commit: `d149c1d7420682abc3ffa411dec5e0e9d0a02c05`
- Fully green PR CI: [run #41434702832](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41434702832)
- Fully green source-branch CI/artifact: [run #41434694585](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41434694585)
- Post-merge main CI: [run #41435305226](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41435305226) — Node passed; duplicate Android job remained in progress at closeout. The main tree hash matches the fully green source tree above.
- Debug APK artifact: `13136570415`, 23,973,708 bytes; SHA-256 `1254690f2d9dcb8505ca6b155c0be206ef249864281972333ddc7aff8b677ae3`.
- Hardware acceptance: Samsung Galaxy Tab A9 hands-on validation is still reserved for Phase 31.
