# JARVIS Phase 21 — Self-Evolving Skill Crucible

**Status:** CODE_COMPLETE (repository scope; physical-device acceptance remains Phase 31)  
**Implementation PR:** [#69](https://github.com/18110priyanshuraj-creator/Jarvis/pull/69), merged to `main` at `0c6c01b617d2f3c6e7ac24adba3813ccfad34ce3`  
**CI run:** [41601724924](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41601724924)

## Goal

Extend the versioned Skill Engine with a deterministic, bounded runtime for small skill programs while keeping approval, capability scope and execution separate from generated arbitrary code.

## Runtime model

The Skill Crucible accepts one strict four-step data-processing program:

1. `normalize_input` — normalize Unicode, case and whitespace.
2. `extract_keywords` — extract a user-configured maximum of 1–8 bounded terms.
3. `match_any` — compare against 1–8 explicit phrases.
4. `format_output` — render a response using only `{input}`, `{keywords}` and `{matched}`.

The schema rejects unknown operations, extra fields, unknown placeholders, loops, branches and malformed step order. Runtime limits include 1,200-character input, 2,000-character output, 800-character templates, 2–10 test cases (including both positive and negative expectations), at most 50 saved programs and bounded version history.

## Lifecycle and trust

- A program is attached to a skill whose current version is already approved and active.
- New programs and edits create drafts/version records. They do not silently replace the currently approved program version.
- The test runner executes only the fixed DSL against bounded test inputs. Reports contain case indexes and boolean outcomes, not the test prompts or generated output.
- Approval requires a passing validation for the current program hash and the still-current approved skill version.
- A manual run rechecks the program hash, skill version, skill trigger and application scope at runtime.
- Programs can be manually tested, approved, run, paused or deleted from the authenticated dashboard and API.
- Runtime execution returns a bounded text result only. Runs are not persisted, and no integration or external action is invoked.

## Explicit capability exclusions

The Skill Crucible does **not** implement JavaScript evaluation, shell/terminal execution, filesystem access, network access, dynamic module loading, Android device actions, arbitrary integration calls, background execution or foundation-model weight training. This is an allow-listed program interpreter, not a general-purpose generated-code sandbox. Skill instructions and program outputs remain untrusted text and do not override the assistant's system policy.

## API

- `GET /api/skill-crucible` — runtime status, active eligible skills and saved programs.
- `POST /api/skill-crucible/programs` — create a draft.
- `PATCH /api/skill-crucible/programs/:id` — create a new version.
- `POST /api/skill-crucible/programs/:id/test` — run bounded tests.
- `POST /api/skill-crucible/programs/:id/approve` — approve a passing current version.
- `POST /api/skill-crucible/programs/:id/run` — execute manually with a supplied input and application ID.
- `POST /api/skill-crucible/programs/:id/pause` and `DELETE /api/skill-crucible/programs/:id` — pause or remove.

All routes require the existing authenticated JARVIS session.

## Verification

CI run [41601724924](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41601724924) completed successfully:

- Node suite: **269 passed, 0 failed**.
- Production dependency audit: **0 vulnerabilities**.
- Android Companion unit tests, debug build, APK integrity/metadata verification and debug-artifact upload: **passed**.

The uploaded APK is a CI debug artifact, not a signed production release. Physical Samsung Galaxy Tab A9 UI, lifecycle, permission and performance acceptance remains Phase 31.
