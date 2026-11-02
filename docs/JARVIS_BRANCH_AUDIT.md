# JARVIS Branch and Pull Request Audit

**Snapshot:** 2026-11-02  
**Repository:** `18110priyanshuraj-creator/Jarvis`  
**Main at audit start:** `1ed891ae5fc45c462843e1ed3f62fd1a841ac31a`

## 1. Current GitHub branches

The GitHub branch search returned three branches. Pagination was exhausted.

| Branch | State | Comparison with main | Decision |
|---|---|---|---|
| `main` | Current default branch | Baseline | Preserve as the single source of truth. |
| `dependabot/gradle/android/org.json-json-20260814` | Open PR #47 | 1 commit ahead, 0 behind; modifies Android test dependency only | Preserve; CI passed. Do not delete. |
| `dependabot/npm_and_yarn/express-rate-limit-8.7.2` | Open PR #48 | 1 commit ahead, 0 behind; modifies package manifest and lockfile | Preserve; CI passed. Do not delete. |

No other GitHub branches were returned. No branch was deleted or merged during this audit.

## 2. Pull request inventory

The recent PR listing returned 36 historical requests: 27 merged and 9 closed without merge. A separate open-PR search returned two current open PRs (#47 and #48). Thus 38 PR records were observed in this audit.

### Current open PRs

| PR | Update | Changed files | CI result | Decision |
|---|---|---|---|---|
| [#47](https://github.com/18110priyanshuraj-creator/Jarvis/pull/47) | `org.json:json` 20240303 → 20260814 | `android/app/build.gradle.kts` | Success | Keep open pending dependency review and merge policy. |
| [#48](https://github.com/18110priyanshuraj-creator/Jarvis/pull/48) | `express-rate-limit` 8.7.1 → 8.7.2 | `package.json`, `package-lock.json` | Success | Keep open pending dependency review and merge policy. |

Both branches are current relative to the audited main head and have successful GitHub Actions runs. They are dependency-only proposals; they do not contain a separate JARVIS product implementation.

### Merged work relevant to the target product

The recent merged history includes:
- #30 — orbital voice interface.
- #38 — bounded built-in Android device-control planner.
- #39 — interruptible Android task execution.
- #40 — system-readiness diagnostics.
- #41 — Google-preferred search and provider-neutral/self-hosted model adapter.
- #42 — Android plan approval and local activity history consolidation.
- #43–#46 — CI and dependency/toolchain updates.

These are already present in current main and must not be reimplemented from older branches without a concrete gap.

### Closed PRs without merge

| PR | Branch / work | Comparison result | Audit decision |
|---|---|---|---|
| #5–#12 | Earlier Phases 2–9 proposals | Each compared head is already an ancestor of current main (`ahead_by=0`) | Their commits are represented in current history through later consolidation/merges. Do not reopen or port wholesale. |
| #27 | Earlier Gemini Live real-time voice proposal | 19 commits ahead of its merge base and 161 behind current main | Historical experiment only. Current docs mark the Gemini Live proposal archived, and merged Phase 18 explicitly chose provider-independent browser/Android voice instead. Do not restore it as a mandatory dependency. |

PR #27's old proposal included Gemini Live API credentials, AudioWorklet capture and streaming audio. The current repository contains an archived note at `docs/PHASE13_REALTIME_VOICE.md` explaining that this was removed from the production orbital experience. The later merged Phase 18 implementation documents speech-recognition/TTS improvements without adding Gemini Live or a mandatory voice provider.

## 3. Deleted production branch and divergent deployment snapshot

Render's event history records that `feat/jarvis-foundation` was deleted from the Render service configuration and the service branch was changed to `main` on 2026-11-01. That branch is not in the current GitHub branch search.

The last live Render deployment still points to commit:

`02e60a6969f0412373b2f2c420f589ded9933287`

This is an old production snapshot, not an ancestor of current main. Comparing it to main gives:
- Common ancestor: `d78bd42c2411b10fdf21a4274aa55a3410d8b940`
- Production snapshot side: 44 commits ahead.
- Current main side: 400 commits ahead.
- Status: diverged.

The old snapshot contains 18 tree entries / 14 blobs. Current main contains 119 entries. Of the 14 old blobs, 12 have different content in main, one (`.gitignore`) is identical, and one old workflow file is absent. The older `.github/workflows/local-first-checks.yml` only ran Node syntax/tests; current `.github/workflows/check.yml` has the broader Node + dependency-audit + Android-build pipeline.

The old production snapshot's application files are smaller earlier versions of files that exist in current main. Current main has a substantially expanded web/server application, modular backend services, Android source, and more tests. **The old files must not be overlaid onto main as a bulk merge.** The old data schema also contains durable chat transcripts and feedback prompt/note fields that the current schema deliberately does not retain. A data migration/backup is required independently of source-code reconciliation.

However, the old data format matters: the previous server persisted a `chats` array in `data/state.json`. The current main normalizer omits `chats` and migrates the other supported collections. This creates a data-preservation gate before deploying main against the old production store. See `JARVIS_PHASE_0_AUDIT.md`.

## 4. Branch/merge actions taken

- No branch was deleted.
- No PR was merged or closed.
- No old code was overwritten.
- No production deployment was triggered.
- Current open Dependabot branches were preserved.
- The old production snapshot SHA and common ancestor were recorded for reproducible follow-up.

## 5. Branch protection recommendation

Main was reported as unprotected, with no required status checks. Before regular Phase 1+ development, enable branch protection requiring the Node quality/dependency-audit job and Android build job to pass. Keep direct emergency admin override controlled. Do not enable a rule that prevents the current audited documentation commit from being recorded.

## 6. Safe next branch policy

Use short-lived branches for feature work only when the review boundary is useful. Merge only after current-base CI is green. Do not delete an open Dependabot branch or any branch with unreviewed unique work. Do not use the old production snapshot as a new development base; treat it as a legacy migration source until its data has been backed up and its differences reconciled.
