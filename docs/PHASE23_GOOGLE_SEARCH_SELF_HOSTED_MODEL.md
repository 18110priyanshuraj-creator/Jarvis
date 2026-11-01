# Phase 23 — Google-preferred search and JARVIS model ownership boundary

## Goal

Bring the requested Google-first internet search path and an owner-controlled JARVIS inference runtime into the existing Phase 1–22 system without replacing memory, voice, research, Android or safety layers.

## Google-preferred search

The search adapter calls a server-configured SearXNG HTTPS endpoint. It passes a validated `engines` list, defaulting to:

`google,duckduckgo,bing`

This asks SearXNG to use Google alongside fallback engines. The SearXNG administrator must enable those engine names and JSON output. The readiness response shows the configured engine list, not a successful connection; the explicit diagnostics connection check is still required.

This is not a direct Google API. Google closed the Custom Search JSON API to new customers in January 2026 and says the existing-customer transition ends 1 January 2027. Direct Google Web Search Service access would require Google's partner access. JARVIS must not claim direct Google API access unless that eligibility is actually granted.

## JARVIS-owned inference runtime

`JARVIS_AI_RUNTIME=self-hosted` labels a configured OpenAI-compatible inference endpoint as owner-controlled JARVIS runtime. It can connect to compatible servers such as Ollama or vLLM behind HTTPS. Local loopback HTTP remains development-only; production URLs must use HTTPS and a private API key.

Required existing server-side values:
- `JARVIS_AI_BASE_URL` — inference base URL, including `/v1` where required.
- `JARVIS_AI_API_KEY` — server-only endpoint credential.
- `JARVIS_AI_MODEL` — model identifier loaded by the inference server.
- `JARVIS_AI_ENABLED=true` and `JARVIS_AI_CHAT_ENABLED=true` — enable chat only after a successful model connection test.

`JARVIS_AI_RUNTIME` defaults to `external`. Diagnostics reports the self-hosted identity only when the setting explicitly says so. A self-hosted open-weight model is not a foundation model trained by JARVIS. Fine-tuning or pretraining is a later project with data provenance, consent, evaluation, safety testing and separate compute; saved memories and feedback do not silently train model weights.

## Runtime topology

- Vercel: dashboard/API and secure orchestration.
- JARVIS model host: separate always-on CPU/GPU server running the inference service.
- Search host: trusted SearXNG instance with Google and fallback engines enabled.
- Neon: persistent application state and explicit user-approved memories/knowledge.
- Android Companion: user-consented device actions through existing allow-lists and cancellation controls.

The Vercel function cannot see `localhost` on the user's tablet or developer machine. A production model endpoint must be reachable from Vercel over authenticated HTTPS. Do not expose unauthenticated inference ports to the public internet.

## Verification

Automated tests cover search-engine routing, Hinglish Google-search detection, and honest runtime identification. Production provider reachability, actual Google-engine results, and model inference remain live connection checks; configuration alone does not prove they work.