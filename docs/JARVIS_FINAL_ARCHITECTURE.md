# JARVIS Final Architecture — Existing State and Target Direction

**Snapshot:** 2026-11-02  
**Architecture decision:** Preserve and evolve the existing repository. Do not replace the project or create a second product.

## 1. Existing architecture observed

```text
Browser UI
  ├── public/index.html
  ├── public/app.js
  ├── orbital-visual.js
  └── voice-controller.js
          │ HTTPS / JSON API
          ▼
Node.js 22+ / Express 5 service
  ├── server.js (routing, authentication, startup and persistence)
  ├── brain.js (deterministic offline rules and embedded knowledge)
  ├── services/
  │    ├── ai-provider.js
  │    ├── agent-planner.js
  │    ├── conversation.js
  │    ├── memory.js / knowledge.js
  │    ├── workflow-engine.js / skill-engine.js
  │    ├── web-research.js / web-page-reader.js / source-answer.js
  │    ├── integrations.js / oauth.js / external-actions.js
  │    └── runtime-store.js
  └── routes/devices.js
          ▲
          │ paired HTTPS device requests
          │
Native Android Companion (Kotlin)
  ├── MainActivity and permission setup
  ├── VoiceControlService / VoiceOutput
  ├── LocalCommandProcessor / AgentPlanRunner
  ├── AccessibilityService / ScreenObserver / UIActionExecutor
  └── DeviceConnector / Keystore token store
```

Current data:
- Durable application collections are stored in Neon JSONB when `DATABASE_URL` is set, or in a server-local JSON file otherwise.
- Temporary chat/session records use Neon runtime tables when configured; otherwise they use process memory.
- Android stores its paired-device credential using Android Keystore-backed encryption and stores a bounded local activity log.
- There is no required Redis service in the current project.

## 2. Target architecture for the requested JARVIS product

The final user experience must be one Android application with the central orb as its launcher/home experience. Internal modularity is encouraged; multiple disconnected user-facing products are not.

```text
Single JARVIS Android Application
  ├── Orb UI + navigation shell
  ├── Voice input/output
  ├── Local system controller
  │    ├── Intent normalization and ambiguity detection
  │    ├── Deterministic local intelligence
  │    ├── Optional on-device learned model
  │    ├── Planner and policy gate
  │    ├── Durable task runtime and checkpoints
  │    ├── Skill registry and constrained skill runner
  │    ├── Verification and bounded recovery
  │    └── Diagnostics and audit events
  ├── Android integration boundary
  │    ├── User-granted accessibility
  │    ├── Screen observation
  │    ├── App launching and supported UI actions
  │    ├── File/document access
  │    └── Explicitly approved external actions
  ├── Local data layer
  │    ├── Room database as canonical structured state
  │    ├── Android Keystore for secrets/credentials
  │    ├── Encrypted backup/export
  │    └── Searchable local knowledge index
  └── Optional connectors
       ├── Public internet through permitted browser/search flows
       ├── Optional user-controlled self-hosted model endpoint
       └── Optional sync/backup gateway
```

This target is an architectural direction, not a claim that those modules already exist. The exact local database, UI toolkit and on-device model must be selected after profiling the actual Samsung Galaxy Tab A9 and auditing the existing Android build.

## 3. Architecture decisions

### A. Android is the primary product boundary

The Android APK should own the primary UI, local memory, task lifecycle, voice controls and permissions. The browser application can remain a development, backup or optional remote access surface while the native app reaches functional parity. It must not remain a mandatory separate product.

### B. No mandatory remote AI provider

The core must keep working without a paid or third-party AI API:
- Deterministic local intent handling and policy rules are always available.
- A local learned model may improve open-ended language understanding only if it can run within tested device resource limits.
- An optional self-hosted model adapter must not be confused with a locally trained foundation model.
- Offline fallback limitations must be stated honestly.

### C. Local canonical state

The Android database should become the authoritative source for local memories, tasks, task checkpoints, skills, knowledge and execution history. Temporary conversation context must remain separate from durable memory. Secrets belong in Android Keystore-backed storage, not ordinary records.

The existing server-side JSON/Neon store should be treated as a migration and optional synchronization source until data has been backed up and reconciled. Do not switch the source of truth in one deploy.

### D. One planner, policy gate and execution runtime

All input surfaces should submit to one internal command model. Every planned action must include:
- capability/skill identifier;
- validated input and output schema;
- required permission;
- risk category;
- expected result;
- timeout/cancellation behavior;
- verification condition.

The executor must verify observed outcomes and stop safely when the UI differs from the plan. A tap returning success is not proof the requested task is complete.

### E. Android capabilities must remain permission-bounded

Accessibility may read only user-granted, exposed UI nodes. Screenshot observation, if added, must use the correct Android consent surface and a clear stop boundary. No hidden recording, security bypass, arbitrary coordinate actions or concealed operation.

### F. Skills must be constrained

The current Skill Engine is a text/trigger registry. Future generated skills must pass isolated tests, permission validation, static security checks, resource limits and rollback review before activation. Do not run generated code with the main app's privileges.

### G. Research and knowledge are different

Public web content is untrusted input. Store source URL, timestamp and provenance. Keep research retrieval distinct from user-approved long-term memory. Saving a note is not model training.

### H. Keep deployment optional for core use

The Android app should not need Render, Neon, Redis or another hosted server just to open, talk locally, read local memory or execute supported on-device tasks. A server may support optional sync, remote access or research proxying, but must not be a required inference dependency.

## 4. Existing technology to preserve

| Existing technology | Decision |
|---|---|
| Kotlin Android app | Preserve and evolve; avoid a replacement APK/package. |
| Node.js 22 / Express 5 | Preserve current web/backend as a migration and optional gateway; do not blindly port all server logic into the app at once. |
| Browser orb rendering | Preserve visual assets and behavior as a reference; port the central experience to the native app. |
| `brain.js` deterministic core | Preserve as baseline knowledge and rule behavior; add tests before refactoring. |
| Existing memory/knowledge/skill/workflow services | Preserve records and behavior during migration; do not duplicate equivalent modules. |
| Neon JSONB/local JSON persistence | Maintain compatibility during a controlled migration; do not discard records. |
| Android Accessibility and voice code | Preserve safety boundaries and lifecycle fixes; test real hardware before extending. |
| Existing Node and Android tests | Keep as regression tests and expand acceptance coverage. |

## 5. Constraints and non-goals

- A no-model deterministic system cannot promise unrestricted natural language understanding.
- Android cannot lawfully grant arbitrary access to every app or bypass protected controls.
- Browser speech recognition may use a provider chosen by the browser/device and is not guaranteed to be offline.
- Accessibility trees do not expose every visual UI element.
- The Galaxy Tab A9's actual RAM, storage, thermal behavior and speech-provider availability must be measured on-device.
- Do not adopt microservices, Redis, Pinecone or a mandatory remote inference endpoint without demonstrated need.

## 6. Migration order

1. Preserve the production state and map all legacy record shapes.
2. Reconcile Render and GitHub histories without a blind merge or deploy.
3. Keep current main green and correct stale documentation/configuration.
4. Build the native orb and single-app shell on top of the existing Android package.
5. Establish Android local persistence and a verified import/export path.
6. Port planner, memory and execution contracts incrementally with regression tests.
7. Add screen/automation capability only through user permissions and verified UI state.
8. Add local model, constrained skill execution and background scheduling only after measured device tests.

No architecture migration should be marked complete solely because packages or diagrams were created.
