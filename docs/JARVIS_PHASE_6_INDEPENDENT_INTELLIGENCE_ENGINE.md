# JARVIS Phase 6 — Independent Intelligence Engine

**Status:** CODE_COMPLETE — deterministic local routing, explicit offline capability boundaries, optional model fallback, planner preference, health metadata and automated regression tests are implemented.
**Baseline:** Phase 5 Offline Voice System on `main`.

## Objective

Give JARVIS an independent, useful intelligence path that continues to work when no external model is configured, while allowing an optional server-configured model adapter to extend open-ended conversation and planning.

## Implemented

- Added a no-match result to the existing deterministic offline brain. Covered requests can now be identified separately from the honest unsupported-question response.
- Route covered calculations, bundled study/debugging knowledge, task/memory lookups and reviewed Knowledge Library answers through the offline brain before requesting an optional conversational model.
- Keep live research ahead of the offline brain for requests classified as needing current sources. A web failure remains disclosed and does not become a claim of verified information.
- Keep the OpenAI-compatible model adapter server-configured. Clients cannot supply model URLs, credentials, model names, headers or tool definitions.
- Prefer the bounded local Android app-search planner before calling the optional model, even when the model adapter is enabled.
- Add a public health capability summary that names the local rule engine and its limits, reports optional adapter readiness, and does not disclose provider credentials, base URLs or raw model names.
- Preserve the existing unsupported-request behavior: if no optional conversation model is ready, the offline brain says what it cannot answer rather than inventing facts.

## Routing contract

1. Explicit memory save/forget and privacy guards continue to run before ordinary conversation handling.
2. When current information is needed, the configured live research path runs first.
3. A deterministic offline match is answered locally and does not call the optional model.
4. An unsupported conversational request may use the optional model only when it is configured and enabled.
5. If the optional model is unavailable or fails, JARVIS returns the existing honest offline limitation response.
6. Device planning first tries the local allow-listed app/search parser. A remote plan is only considered for unsupported requests and remains validated by the server and Android client before execution.

## Capability boundary

- The offline brain is a deterministic rule engine with a small bundled knowledge pack. It is **not** a general-purpose local LLM.
- The optional model adapter may target a self-hosted or external OpenAI-compatible endpoint configured by the server owner. It is not bundled with the Android app and may require internet, a hosted service or a separately provisioned local inference server.
- A self-hosted endpoint is not proof of on-device or offline inference. No model weights are downloaded, trained or fine-tuned by this phase.
- User feedback, saved skills and knowledge do not automatically train model weights. Only explicitly approved saved knowledge is provided as reference material through existing paths.
- The Android action allow-list, user-started voice controls, pairing requirements, safety checks and action-preview policy remain in force.

## Verification

- Node tests cover the offline no-match contract, local calculation routing, honest model capability metadata and deterministic device-plan preference.
- Full Node tests, dependency audit, Android unit tests, Android debug build and APK verification are run by the existing GitHub Actions workflow.
- The live Render deployment is checked against the final `main` commit after CI.
- Actual offline model availability, Android audio, accessibility and Samsung Galaxy Tab A9 behavior are not claimed here; hardware acceptance remains Phase 31.

## Acceptance boundary

Phase 6 is code-complete when the deterministic path is selected before optional model calls for supported requests, unsupported requests fall back only through configured adapters or an honest refusal, device planning prefers deterministic rules, health metadata is secret-safe, and the full repository CI passes.
