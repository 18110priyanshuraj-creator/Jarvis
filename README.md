# JARVIS — private personal AI assistant

JARVIS is a self-hostable starting point for a personal assistant dashboard. This foundation includes a password-protected web UI, chat through a separately hosted Ollama-compatible model, editable saved memories, tasks, optional SearXNG research, browser voice input/output where supported, request limits, and basic server-side security controls.

**This is a working foundation, not yet a fully autonomous agent.** It does not send messages, operate your accounts, or run arbitrary shell commands.

## Features in this branch

- Password login with an HttpOnly, SameSite session cookie and rate-limited login attempts.
- Chat requests sent from the backend to an Ollama server; no Gemini API key is required.
- User-editable memory notes and task list stored in a local JSON file.
- Optional server-configured web research through SearXNG.
- Optional browser speech recognition and text-to-speech.
- Security headers, same-origin checks, JSON request limits, and bounded data fields.
- Render Blueprint and Node.js syntax-check command.

## Requirements

- Node.js 22 or later.
- An Ollama service reachable from the JARVIS backend, with the model configured by \`JARVIS_MODEL\` already installed.
- A long, unique \`JARVIS_PASSWORD\`.
- Optional: a trusted SearXNG instance for research.

## Run locally

1. Copy \`.env.example\` to \`.env\`.
2. Set \`JARVIS_PASSWORD\` to a long, unique password.
3. Set \`OLLAMA_BASE_URL\` to the Ollama server's root URL and \`JARVIS_MODEL\` to a model installed there.
4. Start Ollama separately and check that the JARVIS server can reach it. Do not expose Ollama publicly without appropriate network controls.
5. Run \`npm install\`, then \`npm start\`.
6. Open \`http://localhost:3000\`.

Run \`npm run check\` for basic JavaScript syntax checks.

## Render deployment notes

The included \`render.yaml\` can create a web service. Set \`JARVIS_PASSWORD\` as a strong secret and set \`OLLAMA_BASE_URL\` to a private or properly secured Ollama service that the Render service can reach. The JARVIS web service does not contain or download a language model by itself.

A free web-service plan generally is not suitable for running a useful local language model inside the same service. You need a model server reachable by the deployed backend, and that server may have its own compute/storage cost. Do not put credentials in source control or expose an unauthenticated model endpoint.

The filesystem on hosted services is often ephemeral. Render Free web services do **not** support persistent disks, so saved JSON data can be lost during restarts or redeploys on the free plan. For persistence, upgrade to a plan that supports a persistent disk and set `JARVIS_DATA_DIR` to its mount path, or move storage to a managed database in a later stage. The included in-process session store logs you out when the process restarts; use a durable session store before multi-user or high-availability use.

## Optional web research

Set \`SEARXNG_URL\` to the base URL of a SearXNG instance you trust. JARVIS requests search results from that configured endpoint. It does not accept a user-supplied arbitrary server URL. Leave the variable unset to disable research.

## Safety boundaries

- The model generates text only. Model output does not grant permission to run a tool.
- No arbitrary shell execution, public posting, email sending, external account changes, or file deletion is implemented.
- Saved memories are notes used as context. Review and delete them from the Memory view; never store passwords, API keys, or access tokens as memories.
- Use HTTPS in production, strong environment secrets, restricted network access to the model server, and backups for persistent data.
- Verify generated answers and sources, especially for medical, financial, legal, or other important decisions.

## Next development stages

Before enabling higher-impact autonomy, add durable database-backed storage, a persistent session store, retrieval with citations, explicit permission checks on every tool call, isolated job execution, approval flows, logs/metrics, automated behavior/security tests, and staged deployment.

