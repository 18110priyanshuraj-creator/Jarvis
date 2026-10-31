# JARVIS — built-in offline core

JARVIS is a private dashboard with login, saved chats, memories, tasks, feedback and skill notes. It includes a deterministic **offline rule-based brain** and an optional, server-side Gemini conversation mode. Gemini chat is disabled unless both `GEMINI_API_KEY` is configured and `GEMINI_CHAT_ENABLED=true`; the offline brain remains the fallback.

## Important capability boundary

The built-in offline mode is **not a general-purpose trained AI model**. A sophisticated, open-ended language model cannot be created merely by deleting an API URL. Offline mode uses explicit rules, a safe arithmetic parser and curated notes; optional Gemini conversation mode is described below. It can help with supported operations, but it cannot reliably answer arbitrary questions, follow open-ended custom instructions like an LLM, access live news, or learn new facts from the internet. It tells the user when a request is outside the built-in knowledge instead of inventing a response.

## Optional Gemini conversation mode

- `GEMINI_API_KEY` enables the Android voice request planner. It receives the current spoken transcript to classify it as chat, safe device action or clarification; screenshots and Android accessibility text are not sent.
- Set `GEMINI_CHAT_ENABLED=true` as well to enable Gemini conversational replies in dashboard chat and paired Android voice chat.
- Conversation context is limited to the eight most recent user/assistant messages (up to 1,200 characters each), plus the current request. Saved memories, tasks, feedback, skills, screenshots and Android accessibility text are not sent as conversation context.
- With the API key absent, the Android planner cannot call Gemini. With chat mode disabled, dashboard chat uses the offline brain; if Gemini chat is enabled but a request fails, it falls back to offline.
- The API key remains server-side. Never put it in the browser bundle or Android APK.

## Built-in features

- Password-protected dashboard with same-origin checks, session cookies, security headers and login rate limiting.
- Arithmetic calculator: basic operations, parentheses, powers, percentages/remainder, constants and selected math functions. Trigonometric functions use radians.
- Bundled notes for Newton's laws, units and dimensions, mole concept, sets, circular motion, Ohm's law, basic JavaScript/debugging and study planning.
- Local search across the embedded knowledge pack (not the web).
- Saved chat history, editable memories, tasks, response feedback and custom skill notes.
- No AI API key is required to use the built-in offline mode; Gemini conversation is optional and opt-in.

Memory and feedback are stored context, not model training. Custom skill notes are saved notes; without a language model, they cannot make the engine generally follow arbitrary instructions. JARVIS does not execute shell commands, modify its own code autonomously, or operate external accounts.

## Run locally

Requirements: Node.js 22 or later.

1. Copy `.env.example` to `.env`.
2. Set `JARVIS_PASSWORD` to a long, unique password.
3. Run `npm install`.
4. Run `npm run check`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

No model download, AI API key or model-server URL is required to run the offline mode. The optional Gemini planner and conversation mode use the server-side key only when configured. The app still needs a web host or a local Node.js process to serve the dashboard; its own browser-to-server requests are necessary for login, chat and storage.

## Render deployment and storage

The web app can run as a Node.js service on Render without a separate model server. The Render hosting URL is still needed to open the web dashboard. When Gemini conversation is explicitly enabled, the server makes requests to Google's AI service; otherwise dashboard chat uses the offline brain. Free hosted filesystems can be ephemeral: JSON-file chats, memories and tasks may be lost during restarts or redeploys. Use a durable database/volume or export and back up important data if persistence is required.

## Security

- Set a strong `JARVIS_PASSWORD` in the host's environment settings; never commit a real secret.
- Do not store passwords, access tokens or other secrets in memories or skill notes.
- This app protects the dashboard with a shared password and cookie session; do not treat it as a multi-user identity system.
- Treat answers as limited offline utilities and notes; verify important information.
