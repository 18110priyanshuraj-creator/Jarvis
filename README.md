# JARVIS — voice assistant with selective memory

JARVIS is a private, single-owner assistant with a web dashboard and an Android Companion. It combines server-side Gemini conversation, Google Search grounding for relevant current questions, temporary chat context, explicitly requested long-term memories, and consent-based Android controls. A built-in offline brain remains available as a limited fallback.

## How JARVIS handles information

- **Ordinary chats are temporary.** The server keeps up to 32 messages per conversation in process memory, with a one-hour inactivity expiry. They are removed on sign-out or server restart. They are not written into Neon or the JSON state file.
- **Long-term memory is selective.** JARVIS saves a preference or fact only when the user explicitly says something like "Remember that I prefer concise Hinglish explanations" or "Yaad rakhna: ...". The Memory screen can review and delete saved notes.
- **Secrets and sensitive personal details are rejected.** Do not ask JARVIS to store passwords, PINs, OTPs, API keys, bank/card details, medical information, home addresses, phone numbers or email addresses.
- **Internet research is not memory.** Relevant current/time-sensitive prompts and explicit requests to check the internet can be routed to Google Search grounding. Responses show available source links. A search result is used to answer the current question and is not saved as a long-term memory or research record automatically.
- **Tasks, explicitly saved research and approved memories** remain in the persistent app state. These are separate from ordinary chat transcripts.

## Voice and Android companion

- The dashboard includes Hindi push-to-talk where supported by the browser and optional spoken replies.
- The Android Companion offers Speak once and user-started hands-free listening with a persistent notification and a Stop control.
- Hindi speech/text-to-speech is preferred, with an English (India) fallback when Hindi language data or recognition is unavailable.
- The Gemini planner separates ordinary conversation from a limited allow-list of Android actions. The Android app validates actions locally before running them.
- Supported everyday actions include opening an app, reading visible labels, safe navigation, scrolling and entering ordinary text in a field the user has already focused. Screen text remains on the device and is not sent as chat history.
- JARVIS does not bypass the lock screen, grant permissions, install apps, access secrets, send messages, place calls, make purchases, or change account/security settings.

The microphone is active only after the user starts the voice session. Use the Android notification's Stop action or the app's Stop control to end it.

## Gemini and live web configuration

All API credentials stay on the server. Never put an API key in the browser bundle, Android APK, GitHub repository or a chat message.

Set these server environment variables:

```dotenv
GEMINI_API_KEY=your-server-side-key
GEMINI_MODEL=gemini-3.8-flash
GEMINI_REQUEST_TIMEOUT_MS=25000
GEMINI_RETRY_ATTEMPTS=2
GEMINI_CHAT_ENABLED=true
GEMINI_WEB_RESEARCH_ENABLED=true
```

- `GEMINI_CHAT_ENABLED=true` enables open-ended conversational replies.
- `GEMINI_WEB_RESEARCH_ENABLED=true` enables grounded live web research for prompts that need current information or explicitly ask to search online.
- Both features also require a valid `GEMINI_API_KEY`. If Gemini is unavailable, JARVIS falls back to its limited offline brain and must not claim that an internet search occurred.
- Chat, planning and research share one server-side Gemini client with a bounded request timeout and a small retry budget for temporary HTTP errors (including rate limiting). Retries improve resilience; they do not increase project quota or rotate keys.
- The public `/api/health` endpoint reports only safe provider readiness metadata (configured state, model identifier and retry settings); it never returns the API key.
- Google Search grounding may have usage limits or costs under the provider's current billing terms. Review the current terms before enabling paid billing.

## Persistent data

Neon PostgreSQL is used when `DATABASE_URL` is configured. Otherwise, local development uses the JSON state file. Chat transcripts are deliberately excluded from both persistent stores. Memories, tasks, feedback ratings, devices and manually saved research use the persistent app state.

## Built-in offline mode

The offline brain is not a general-purpose language model. It contains a safe arithmetic parser, deterministic rules and a curated knowledge pack for selected topics such as Newton's laws, units and dimensions, mole concept, sets, circular motion and Ohm's law. It cannot answer arbitrary questions or fetch live web information without Gemini.

## Run locally

Requirements: Node.js 22 or later.

1. Copy `.env.example` to `.env`.
2. Set a long, unique `JARVIS_PASSWORD`.
3. Run `npm install`.
4. Run `npm run check`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Security notes

- This is a single-owner dashboard protected by a shared password and cookie session, not a multi-user identity system.
- Keep `JARVIS_PASSWORD`, `DATABASE_URL` and `GEMINI_API_KEY` private.
- Review Android permissions yourself and enable only what you understand and need.
- Treat model outputs as fallible. Verify important claims against the linked sources or trusted people.
