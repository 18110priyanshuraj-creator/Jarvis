# Phase 11 — Release Gates and CI Hardening

## Goal

Make JARVIS changes easier to verify before they reach the production branch. This phase is deliberately additive: it does not deploy, change production environment variables, or modify the live database.

## Automated checks

The consolidated `.github/workflows/check.yml` workflow runs for pushes to `main` and `feat/**`, pull requests targeting `main` or a feature branch, and manual workflow dispatch.

The Node.js job:
1. Uses Node.js 22.
2. Generates a temporary npm lockfile for the current run, then installs from that generated lock with `npm ci`.
3. Runs `npm run check` (syntax checks and the Node test suite).
4. Runs `npm audit --omit=dev --audit-level=high`.
5. Uploads the generated lockfile as a short-retention artifact for review and repository adoption.

The Android job:
1. Uses JDK 17 and Gradle 8.14.6.
2. Builds the Companion debug APK.
3. Verifies the APK archive, computes its SHA-256 checksum, and records commit/build metadata.
4. Uploads the verified APK and metadata as a seven-day artifact.

Concurrency cancels superseded runs for the same branch or pull request. Workflow permissions are limited to repository contents read access. No production deployment job or secret access is added.

## Dependency updates

Dependabot checks npm dependencies, Android Gradle dependencies, and GitHub Actions weekly. Updates arrive as pull requests and still have to pass the normal CI gates and human review.

## Required release sequence

1. Review and verify the Phase 10 shared-runtime change on a non-production preview environment, including Neon schema creation and session/OAuth behavior across separate server instances.
2. Merge Phase 10 only after its review and preview checks are complete.
3. Retarget the Phase 11 pull request to `main` after Phase 10 is merged.
4. Require the Node.js tests, production dependency audit, and Android build/APK verification to pass.
5. Verify the resulting Vercel preview, authentication, database connectivity, Google OAuth callback, and Android Companion pairing before any production promotion.
6. Promote to production only as a deliberate, separately reviewed action.

## Lockfile adoption note

The repository currently has no committed `package-lock.json`. This workflow bootstraps one during CI and uploads it as an artifact so the resolved dependency tree can be reviewed before it is committed. Until a reviewed lockfile is committed, installs are reproducible within an individual CI run but are not guaranteed to resolve identically across different runs. Phase 11 is not complete until the lockfile is committed and the workflow is switched to plain `npm ci`.

## Manual checks still required

CI can build the Android APK, but it cannot establish that the microphone, speech recognition, notification controls, and pairing work on a physical device. Those checks must be performed on a real Android device before release.
