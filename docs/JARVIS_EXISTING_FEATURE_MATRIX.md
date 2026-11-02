# JARVIS Existing Feature Matrix

**Snapshot:** 2026-11-02  
**Source baseline:** `main` at `90741abf4ee5a592ff025cf26f3ab5fed62cef48` (2026-11-02); Phase 15 verification hardening is tracked separately in PR #55.

This matrix describes what exists in source and what is supported by test/deployment evidence. "Implemented" does not imply a physical-device or live-provider test.

| Capability | Existing implementation | Status | Verified evidence / limitation |
|---|---|---|---|
| Browser and native orbital interfaces | `public/index.html`, `public/orbital-visual.js`, `OrbitalOrbView.kt` | PARTIAL | Browser Assistant view and a native Android orb exist. The native orb is the Android launcher home; full parity and actual Galaxy Tab A9 visual/performance acceptance remain pending. |
| Unified application shell | Browser views for Assistant, Devices, Research, Knowledge, Tasks, Memory, Skills, Experience, Workflows, Connections, Action Center and System Status | PARTIAL | A single web shell exists, but the Android Companion remains a separate application and not all functionality is inside one APK. |
| Native Android app | Kotlin app under `android/app/` | PARTIAL | CI builds the debug APK; app is still labelled/structured as a Companion and opens pairing/permissions/voice controls. |
| Local system controller | `server.js`, `services/`, Android voice and accessibility packages | PARTIAL | Modular services exist, but there is no single on-device controller owning every capability. |
| Offline voice input/output | Android SpeechRecognizer/TTS and browser Web Speech APIs | PARTIAL | User-started voice flows exist. Offline recognition depends on the installed Android/browser speech provider and device support. |
| Independent offline intelligence | `brain.js`, local command rules in `services/agent-planner.js` and Android `LocalCommandProcessor.kt` | PARTIAL | Deterministic calculator, bounded rules and a small embedded knowledge pack work without a model. This is not a general-purpose trained LLM. |
| Hindi/Hinglish/English interpretation | Regex/rule-based phrase handling and optional planner adapter | PARTIAL | Selected Hindi/Hinglish/English command patterns are covered; unrestricted mixed-language understanding is not. |
| Persistent memory | `services/memory.js`, server state and Memory UI | PARTIAL | User-approved preference/goal/fact records support search/edit/delete. Storage is server-side JSON/Neon, not an Android-local Room database. |
| Task planning | `services/agent-planner.js` | PARTIAL | Optional provider planner plus bounded deterministic app-search patterns; current plan is capped and validates allow-listed actions. |
| Persistent task/workflow execution | `services/workflow-engine.js`, `LocalTaskExecutionJournal.kt`, `CancellableActionSequence.kt` | PARTIAL | Server workflows have durable checkpoints/retry; Android sequences persist generic per-step checkpoints and stop safely after interruption, requiring manual replan rather than automatic replay. Android journal is bounded and local. |
| Screen perception | `ScreenObserver.kt`, `JarvisAccessibilityService.kt` | PARTIAL | Explicit one-shot accessibility summaries and on-device OCR/screenshot reading are present with sensitive-screen protection. Not a continuous or general visual-understanding engine. |
| Android action engine | `UIActionExecutor.kt`, `UiActionPolicy.kt`, `AgentPlanRunner.kt` | PARTIAL | Bounded app launch, exact visible-label click, focused non-sensitive text entry, scroll, Back and Home. PR #55 adds required foreground-app and visible-text outcome checks; arbitrary gestures and unrestricted app automation remain unsupported. |
| Skill registry | `services/skill-engine.js` and Skills UI | PARTIAL | Versioned instruction/trigger records, static validation, tests and approval. It does not execute newly generated code. |
| Error detection/recovery | Workflow runner, action sequence failure checks and retry boundaries | PARTIAL | Some failures stop later steps and preserve status; no general autonomous root-cause repair engine. |
| Full Android task integration | Device pairing, planner, accessibility, approval, cancellable sequence and local journal | PARTIAL | Typed Orb, one-shot voice and hands-free paths share planning/approval/execution. PR #55 requires app/result verification before proceeding. Current search template enters and verifies the query but leaves submission and result selection to the user; this is not full cross-app automation or Canva/YouTube automation. |
| Internet research | `services/web-research.js`, `services/web-page-reader.js` | PARTIAL | Requires a configured trusted SearXNG JSON endpoint and optional page reader. It is not a built-in browser agent that can freely navigate arbitrary websites. |
| Media creation | No end-to-end media generation/export subsystem found | NOT_STARTED | No verified storyboard-to-video file creation pipeline. |
| YouTube publishing | No YouTube publishing workflow found | NOT_STARTED | No verified upload/publish flow or publication approval gate. |
| Independent learning | Knowledge Library and explicitly saved research | PARTIAL | Stores user-reviewed/source-backed notes. Saving notes is not model-weight training or autonomous continual learning. |
| Knowledge manager | `services/knowledge.js` and Knowledge UI | PARTIAL | Text records, tags/categories, source URLs, review states and search. No broad local document/media ingestion system. |
| Skill creation crucible | Draft/version/test/approve flow | PARTIAL | Tests are static trigger/safety checks. No isolated runtime for generated programs, sandbox or new executable capability. |
| Auto-heal | No self-patching/rollback subsystem found | NOT_STARTED | No production code self-modification; this is correctly not claimed. |
| Specialist workers | Modular server services only | NOT_STARTED | No separately orchestrated research/coding/operator/verification worker architecture. |
| Proactive assistant | Tasks and saved workflows | PARTIAL | No dependable scheduler/recurrence engine with Android background execution. |
| File management | Limited server file reading for web pages and text knowledge records | NOT_STARTED | No local full file manager, PDF/image/audio/video processing or verified media export pipeline. |
| Hardware intelligence | No hardware reference/circuit subsystem found | NOT_STARTED | Not implemented. |
| Geospatial intelligence | No location/map subsystem found | NOT_STARTED | Not implemented. |
| Advanced voice | One-shot browser/Android speech and a user-started Android foreground service | PARTIAL | No wake word, always-on listening, guaranteed offline recognition or native full-duplex conversational audio. |
| Security/reliability | Password auth, rate limits, CSP/Helmet, OAuth PKCE, encryption, approval gates and Android protected-action checks | PARTIAL | Strong baseline, but branch protection, migration, deployment and real-device security checks remain open. |
| Final central integration | Shared browser app plus Android Companion | PARTIAL | Not yet one coherent all-in-one Android application. |
| Real-device acceptance | CI-only Android build available | BLOCKED | No Galaxy Tab A9 install, runtime, accessibility, microphone or performance evidence. |
| Production release | Debug APK CI artifact and Render web deployment | BLOCKED | No signed release APK or verified unified Android product release. |

## Key implementation boundaries

### Local intelligence versus optional providers

- `brain.js` deliberately describes itself as deterministic rules and an embedded knowledge pack, not an LLM.
- `services/ai-provider.js` supports a configured OpenAI-compatible endpoint. It is optional, but it is not a locally trained model.
- Live web research uses a configured SearXNG endpoint; that search service is not bundled into the Android APK.
- Offline fallback can calculate supported expressions, answer selected embedded topics and handle simple patterns. It cannot provide open-ended human-level reasoning.

### Skills versus executable automation

The existing Skill Engine stores instructions, triggers, versions, static test cases and approval status. It does not execute arbitrary generated code. This is safer than executing generated scripts inside the server, but it does not yet satisfy the requested self-generating executable skill system.

### Android perception versus visual automation

Android reads accessibility nodes when permitted. It does not currently capture screenshots or interpret arbitrary visual layouts. The accessibility service is configured with gesture support disabled, and the action executor rejects sensitive controls such as send, submit, delete, payment, purchase and security controls.

### Persistence and legacy data

The old production server wrote chat transcripts to the durable application JSON. The current server uses session-scoped temporary chat storage and intentionally drops the old `chats` field when normalizing legacy state. A backup/archive is required before migration.
