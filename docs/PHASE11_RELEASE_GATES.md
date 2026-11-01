# Phase 11 — Release Gates and CI Hardening

## Goal

Make JARVIS changes easier to verify before they reach the production branch. This phase is deliberately additive: it does not deploy, change production environment variables, or modify the live database.

## Phase 10 dependency — merged

Phase 10 has been merged into `main` in commit `60363f1fe7088424a5c62b80aaad9803f7e36d89`. Phase 11 now targets `main` directly; this is a stacked change no longer dependent on an open Phase 10 branch.

The Phase 10 runtime table/index migration and `jarvis_app_state.revision` migration were successfully exercised on the isolated Neon branch `phase10-preview-validation`. The source-based preview build completed and is READY. Its HTTP health route and multi-instance/OAuth runtime checks remain unverified because the Vercel preview access helper could not retrieve that deployment. Production Neon and production Vercel were not changed.

## Automated checks

The consolidated `.github/workflows/check.yml` workflow runs for pushes to `main` and `feat/**`, pull requests targeting `main` or a feature branch, and manual workflow dispatch.

The Node.js job:
1. Uses Node.js 22.
2. Installs the committed npm dependency tree with `npm ci`; the tracked `package-lock.json` fixes exact dependency versions and integrity hashes for CI.
3. Runs `npm run check` (syntax checks and the Node test suite).
4. Runs `npm audit --omit=dev --audit-level=high`.

The Android job:
1. Uses JDK 17 and Gradle 8.14.6.
2. Builds the Companion debug APK.
3. Verifies the APK archive, computes its SHA-256 checksum, and records commit/build metadata.
4. Uploads the verified APK and metadata as a seven-day artifact.

Concurrency cancels superseded runs for the same branch or pull request. Workflow permissions are limited to repository contents read access. The workflow does not access production secrets or perform a production deployment.

## Merge protection limitation

CI runs on pull requests, but required-check enforcement is a separate GitHub repository setting. The Phase 0 audit found no branch protection on `main`, and Phase 11 does not silently change repository permissions. Until an administrator enables branch protection or a repository ruleset and marks both CI jobs as required, failed checks may not block a merge or a direct push. Configure these required checks before treating the release process as fully enforced:
- `Node.js tests and dependency audit`
- `Android Companion build and APK verification`

## Dependency updates

Dependabot checks npm dependencies, Android Gradle dependencies, and GitHub Actions weekly. Updates arrive as pull requests and still have to pass the normal CI gates and human review.

## Required release sequence

1. Phase 10 is merged to `main` (completed).
2. Run the final Phase 11 Node.js, dependency audit and Android build/APK checks against `main`.
3. Enable branch protection/repository ruleset required checks, then require the Node.js tests, production dependency audit, and Android build/APK verification to pass.
4. Verify the resulting Vercel preview, authentication, database connectivity, Google OAuth callback, and Android Companion pairing before any production promotion.
5. Promote to production only as a deliberate, separately reviewed action.

## Manual checks still required

CI can build the Android APK, but it cannot establish that the microphone, speech recognition, notification controls, and pairing work on a physical device. Those checks must be performed on a real Android device. Google OAuth must also be tested once its OAuth client credentials and token-encryption key are available in the preview environment.
