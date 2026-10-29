# JARVIS — local-first personal assistant

JARVIS is a private, self-hostable assistant dashboard with an **Ollama-compatible local-model backend**. It has a password-protected web UI, persistent JSON-file notes/tasks/feedback/skills, chat history, optional SearXNG research, and browser voice features.

**No Gemini or other hosted AI API is used by the chat backend in this branch.** JARVIS still needs a pretrained language model running on a machine you control or a model server you trust. It does not create a capable language model from scratch.

**This is a foundation, not a fully autonomous or self-training AGI.** Feedback and approved skill instructions are saved and supplied as context; they do not automatically modify model weights. The app does not execute arbitrary shell commands, edit its own source automatically, or act on external accounts.

## Included

- Password login with an HttpOnly, SameSite session cookie and rate-limited login attempts.
- Local-first chat through an Ollama-compatible model server; there is no Gemini fallback.
- User-editable memories, tasks, response feedback, and custom skill notes.
- Recent feedback and approved skills are supplied to the model as guidance on later chats.
- Optional SearXNG research, disabled unless configured.
- Security headers, same-origin checks, bounded input fields, and JSON request limits.
- Render Blueprint and Node.js syntax-check command.

## Requirements

- Node.js 22 or later.
- Ollama (or a compatible local inference server) running a model already installed, such as a model matching `JARVIS_MODEL`.
- A long, unique `JARVIS_PASSWORD`.
- Optional: a trusted SearXNG instance for web research.

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `JARVIS_PASSWORD` to a long, unique password.
3. Install and start Ollama on your own machine, then download a compatible model using Ollama's own instructions.
4. Set `OLLAMA_BASE_URL` to the model server's root URL and `JARVIS_MODEL` to the exact installed model name.
5. Run `npm install`, then `npm start`.
6. Open `http://localhost:3000`.
7. Run `npm run check` for syntax and integration tests.

Do not expose an unauthenticated Ollama endpoint to the public internet. Keep model inference on your own hardware or behind a private, authenticated network.

## Render deployment reality

Render's free web service does not automatically include Ollama or a language model, and `OLLAMA_BASE_URL=http://127.0.0.1:11434` only works if a model server actually runs in that same network namespace. Setting this variable alone does not install or start a model. For hosted use, configure a secured model server reachable from Render; that server may require separate compute and storage. If no model server is available, JARVIS reports a connection error rather than falling back to Gemini or another AI API.

The filesystem on hosted services can be ephemeral. Render Free web services do **not** support persistent disks, so JSON-file memory may be lost on restarts/redeploys. For durable cloud memory, use a paid persistent disk or migrate the store to a managed database. For a truly private setup with no third-party AI service, run both JARVIS and the model server on hardware you control.

## Memory, feedback, skills, and “learning”

- Memories are editable notes and are injected into chat context.
- Feedback records whether a response was helpful and optional comments; recent feedback guides future prompts.
- Skill entries are user-approved instruction notes injected as context. Treat them as instructions for writing/planning, not executable code.
- These features provide persistent context and behavioral guidance. They **do not train the model weights** or guarantee it learns correctly over time. Actual fine-tuning requires curated training data, compute, and evaluation.
- There is no autonomous self-modification or arbitrary command execution in this branch.

## Optional web research

Set `SEARXNG_URL` to a SearXNG instance you trust. Leave it unset to disable web search. Research uses the configured search service; this is separate from the local model backend.

## Safety and operations

- Model output does not grant permission to run tools.
- No arbitrary shell execution, public posting, email sending, external account changes, or self-editing code is implemented.
- Never store passwords, API keys, or access tokens in memories or skills.
- Use HTTPS, strong secrets, restricted network access to the model server, and backups for persistent data.
- Verify generated answers and sources, especially for important decisions.
