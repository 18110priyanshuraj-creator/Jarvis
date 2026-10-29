# JARVIS — built-in offline core

JARVIS is a private dashboard with login, local JSON-backed chats, memories, tasks, feedback and skill notes. Its chat engine is a small **self-contained deterministic rule engine** with an embedded knowledge pack. It does not call Gemini, Ollama, an LLM API, a model server, or a remote search service. The server-side chat and knowledge-search routes make no outbound network requests.

## Important capability boundary

This version is **not a general-purpose trained AI model**. A sophisticated, open-ended language model cannot be created merely by deleting an API URL. This build uses explicit rules, a safe arithmetic parser and curated offline notes. It can help with supported operations, but it cannot reliably answer arbitrary questions, follow open-ended custom instructions like an LLM, access live news, or learn new facts from the internet. It tells the user when a request is outside the built-in knowledge instead of inventing a response.

## Built-in features

- Password-protected dashboard with same-origin checks, session cookies, security headers and login rate limiting.
- Arithmetic calculator: basic operations, parentheses, powers, percentages/remainder, constants and selected math functions. Trigonometric functions use radians.
- Bundled notes for Newton's laws, units and dimensions, mole concept, sets, circular motion, Ohm's law, basic JavaScript/debugging and study planning.
- Local search across the embedded knowledge pack (not the web).
- Saved chat history, editable memories, tasks, response feedback and custom skill notes.
- No Gemini/Ollama/model/search service URL or AI API key is required by the application.

Memory and feedback are stored context, not model training. Custom skill notes are saved notes; without a language model, they cannot make the engine generally follow arbitrary instructions. JARVIS does not execute shell commands, modify its own code autonomously, or operate external accounts.

## Run locally

Requirements: Node.js 22 or later.

1. Copy `.env.example` to `.env`.
2. Set `JARVIS_PASSWORD` to a long, unique password.
3. Run `npm install`.
4. Run `npm run check`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

No model download, AI API key or model-server URL is required. The app still needs a web host or a local Node.js process to serve the dashboard; its own browser-to-server requests are necessary for login, chat and storage.

## Render deployment and storage

The web app can run as a Node.js service on Render without a model server. The Render hosting URL is still needed to open the web dashboard, but the chat engine does not call any AI provider URL. Free hosted filesystems can be ephemeral: JSON-file chats, memories and tasks may be lost during restarts or redeploys. Use a durable database/volume or export and back up important data if persistence is required.

## Security

- Set a strong `JARVIS_PASSWORD` in the host's environment settings; never commit a real secret.
- Do not store passwords, access tokens or other secrets in memories or skill notes.
- This app protects the dashboard with a shared password and cookie session; do not treat it as a multi-user identity system.
- Treat answers as limited offline utilities and notes; verify important information.
