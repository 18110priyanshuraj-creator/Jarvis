# JARVIS — voice assistant with selective memory

JARVIS is a private, single-owner assistant with a web dashboard and an Android Companion. It combines server-side Gemini conversation, Google Search grounding for relevant current questions, temporary chat context, explicitly requested long-term memories, and consent-based Android controls. A built-in offline brain remains available as a limited fallback.

## How JARVIS handles information

- **Ordinary chats are temporary.** The server keeps up to 32 messages per conversation in process memory, with a one-hour inactivity expiry. They are removed on sign-out or server restart. They are not written into Neon or the JSON state file.
- **Long-term memory is selective.** JARVIS saves a preference or fact only when the user explicitly says something like "Remember that I prefer concise Hinglish explanations" or "Yaad rakhna: ...". The Memory screen can review and delete saved notes.
- **Secrets and sensitive personal details are rejected.** Do not ask JARVIS to store passwords, PINs, OTPs, API keys, bank/card details, medical information, home addresses, phone numbers or email addresses.
- **Internet research is not memory.** Relevant current/time-sensitive prompts and explicit requests to check the internet can be routed to Google Search grounding. Responses show available source links. A search result is used to answer the current question and is not saved as a long-term memory or research record automatically.
- **Tasks, explicitly saved research and approved memories** remain in the persistent app state. These are separate from ordinary chat transcripts.

## Memory and Personal Data Controls (Phase 3)

- Temporary conversation turns stay in process memory only, expire after one hour of inactivity, and are not part of database/file snapshots.
- Durable memories are saved only through an explicit “Remember / Yaad rakhna” instruction or the Memory form. Ordinary chat is never automatically promoted to long-term memory.
- Memory entries support preference, goal, and fact categories; the Memory screen supports keyword/category search, edit, and delete.
- Duplicate detection normalizes Unicode, casing, and repeated whitespace. The server also rejects likely credentials and sensitive personal records.
- Only a small number of relevant saved memories are supplied to the Gemini conversation context. Unrelated memories are not sent with every prompt.
- The persistent data collections remain separated: memories, Knowledge Library entries, explicitly saved research, tasks, and custom skills.
- **Export my data** downloads a JSON file containing these durable user data collections. It deliberately excludes temporary conversations, paired-device credentials, server environment variables/API keys, and anonymous feedback metadata.
- Signing out clears the active temporary session transcript. It does not delete durable memories, notes, tasks, or research; those remain reviewable and individually deletable.

### Memory API

- GET /api/memories?q=<query>&category=<preference|goal|fact> — search/filter saved memories.
- POST /api/memories — save an explicitly supplied memory (duplicates return the existing record).
- PATCH /api/memories/:id — edit a saved memory.
- DELETE /api/memories/:id — delete a saved memory.
- GET /api/export — download authenticated, privacy-filtered personal data.

## Learning and Skill Engine (Phase 4)

- A new skill begins as a **draft**. It contains a name, instruction text, explicit trigger phrases, and example requests that should and should not match.
- The **Run tests** action performs static trigger matching and text-safety checks only. It does not execute JavaScript, shell commands, browser scripts, app actions, or user-supplied code.
- A draft can be **approved and activated** only after its current version passes validation and the user explicitly approves it.
- Editing an approved skill creates a new draft version. The previous approved version remains active until the new version passes validation and is approved.
- Skills can be paused or deleted. Paused skills are not added to conversation context.
- Only approved, safe, trigger-matching skills are supplied as optional guidance to Gemini chat. They cannot override system/safety instructions or authorize external actions.
- Legacy saved skills are migrated to version 1 to preserve their existing content. Skills with no trigger phrases are not automatically applied.
- The offline rule-based brain cannot interpret arbitrary skill instructions; without a configured conversational AI model, skills are stored and validated but are not executed as open-ended reasoning.

### Skill API

- GET /api/skills — list skills.
- POST /api/skills — create a draft.
- PATCH /api/skills/:id — create a new draft version.
- POST /api/skills/:id/validate — run static trigger tests for the current version.
- POST /api/skills/:id/approve — approve and activate a passing current version.
- POST /api/skills/:id/pause — pause an active skill.
- GET /api/skills/:id/versions — list saved version history.
- DELETE /api/skills/:id — delete a skill and its versions.

## Experience and self-improvement (Phase 5)

- Assistant messages offer **Helpful** and **Needs work** feedback. A negative rating can include a category (accuracy, clarity, tone, relevance, format, or other) and an optional improvement suggestion.
- Feedback records contain only the rating, category, optional suggestion, engine label and timestamp. The submitted chat prompt and assistant reply are not copied into the feedback record; legacy `prompt` and `note` fields from older clients are ignored.
- The Experience dashboard shows aggregate feedback counts, issue categories, pending suggestions, and approved response preferences.
- A suggestion becomes a response preference only after the user explicitly presses **Approve as preference**. Preferences can be paused or deleted at any time.
- Only user-approved active preferences are included as optional guidance in Gemini conversation context. They cannot override system/safety rules, act as factual evidence, or authorize external actions.
- Response preferences do not train model weights. There is no automatic fine-tuning or hidden prompt rewriting from ratings.
- The offline rule-based brain does not interpret open-ended response preferences. They are applied only when the Gemini conversational model is configured and enabled.
- Text screening rejects common credential/contact patterns, but it is not a complete privacy detector. Do not submit passwords, API keys, contact details or other sensitive information in feedback.

### Experience API

- GET /api/experience — return aggregate counts, structured feedback records and response preferences.
- POST /api/feedback — save a rating, category, optional suggestion and engine label without storing the chat prompt.
- POST /api/feedback/:id/approve — explicitly promote a constructive suggestion to a response preference.
- PATCH /api/experience/preferences/:id — enable or pause an approved preference.
- DELETE /api/experience/preferences/:id — delete an approved preference.
- DELETE /api/feedback/:id — delete a feedback record.

## Workflow execution engine (Phase 6)

- Workflows are stored as local, reusable JSON definitions with a name, description, step list and version.
- A new workflow starts as a **draft**. Static validation checks the workflow structure and allow-listed step types; it does not execute anything.
- The user must explicitly approve the validated current version before a Run action becomes available. Each run also requires a separate confirmation in the dashboard.
- Editing an approved workflow creates a new draft version and removes its approval until the new version has been validated and approved.
- Supported step types are deliberately local and limited:
  - `create_task` — create a task in the JARVIS Tasks list.
  - `save_memory` — save one safe personal memory using the existing memory privacy checks.
  - `search_knowledge` — search the saved Knowledge Library.
  - `draft_text` — prepare a text draft in the execution result; nothing is sent or published.
  - `review_checkpoint` — pause the run so the user can review completed steps before choosing Continue or Stop.
- Workflow steps execute in order. A failed step stops later steps. Each run keeps a bounded step log, result summaries and status.
- Users can continue a run at an explicit review checkpoint or stop it. Workflows can also be paused or deleted.
- Limits: 50 saved workflows, 10 steps per workflow, and 100 recent execution records.
- The engine does not run shell commands, execute user-supplied code, send messages, publish posts, make purchases/payments, change security settings, or perform unapproved Android device operations.
- This phase does not connect workflow steps to an autonomous background worker or external app connectors. Actions run in the authenticated dashboard request using the local JARVIS data store.

### Workflow API

- GET /api/workflows — list workflows and recent execution history.
- POST /api/workflows — create a workflow draft.
- PATCH /api/workflows/:id — create a new unapproved version of an existing workflow.
- POST /api/workflows/:id/validate — statically validate the current version.
- POST /api/workflows/:id/approve — approve a version after validation.
- POST /api/workflows/:id/run — explicitly start an approved workflow.
- POST /api/workflow-runs/:id/continue — continue after a review checkpoint.
- POST /api/workflow-runs/:id/stop — stop an active run.
- POST /api/workflows/:id/pause — pause a saved workflow.
- DELETE /api/workflows/:id — delete a workflow while preserving its run history.

## Connected Services and Integrations (Phase 7)

- The Connections dashboard lists four optional read-only providers: GitHub, Google Drive, Telegram, and ElevenLabs.
- Credentials are read only from server environment variables. They are never entered into browser forms or stored in the app JSON/Neon state, workflow definitions, run logs, or data export.
- All provider requests use fixed HTTPS endpoints and GET only, with an eight-second request timeout, redirect blocking, safe response summaries, and no raw provider error bodies returned to the dashboard.
- GitHub: checks repository metadata access and can list up to eight recently updated repositories. For a fine-grained personal access token, grant only **Metadata: read** for the repositories you select.
- Google Drive: lists up to eight recent file metadata records. The configured access token should use the `https://www.googleapis.com/auth/drive.metadata.readonly` scope. Access tokens expire; refresh-token OAuth is not implemented.
- Telegram: checks the configured bot profile using the read-only getMe endpoint. It does not send messages.
- ElevenLabs: reads a limited account/subscription summary. It does not generate audio or consume generation credits.
- Each provider can be tested from the Connections dashboard. A configured credential does not mean the provider has been verified; use **Test connection** to check it.
- Connections can be disabled/re-enabled inside JARVIS. Disabling blocks future tests and workflow actions; to revoke a credential fully, remove it from the host environment and rotate it at the provider.
- The Workflow builder includes four read-only integration steps. Each executes only as part of a workflow that has been validated, explicitly approved, and separately run by the user.
- Providers that are not configured fail their workflow step safely; later steps do not execute after the failure. No credential value is included in the result.
- Limits: the connection-test endpoint is rate limited; provider calls are bounded to eight seconds and each list result is capped at eight records.

### Server environment variables

Set values in the private server environment settings (not in the Git repository):
- `JARVIS_GITHUB_TOKEN`
- `JARVIS_GOOGLE_DRIVE_ACCESS_TOKEN`
- `JARVIS_TELEGRAM_BOT_TOKEN`
- `JARVIS_ELEVENLABS_API_KEY`

### Integration API

- GET /api/integrations — return provider names, required environment variable names, configured flags and read-only capability descriptions; never returns credential values.
- POST /api/integrations/:provider/test — test one supported connection and return a limited sanitized profile/summary.
- Supported workflow actions: `github_list_repositories`, `google_drive_list_files`, `telegram_get_bot_profile`, `elevenlabs_get_account`.

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

## Knowledge Library (Phase 2)

- The Knowledge screen is separate from personal Memory, ordinary temporary chat, and the Saved Research history.
- Add a note manually or choose **Save to Knowledge** on a web research result. Internet results are never stored automatically.
- Each saved item keeps its title, content, category, tags, source links, available claim-level citations, and review status.
- Web-research entries start as **unreviewed**. You can mark them as reviewed after checking the source links; this records your action and does not mean JARVIS independently verified every claim.
- JARVIS detects exact normalized title/content duplicates, supports local keyword search, and retrieves a small number of relevant entries as reference context for Gemini or the offline fallback.
- Saved web content is treated as untrusted reference material. It must not override system instructions or be treated as proof by itself.
- This is retrieval-augmented context, not model training, automatic web crawling, or permanent learning of model weights.

The current implementation stores text knowledge records in the existing jarvis_app_state JSONB snapshot (or local JSON state when Neon is not configured). It currently allows up to 300 entries, with an 8,000-character content limit per entry. This is **not** a 200 GB document/media storage system: PDFs, images, videos, embeddings, and large binary files are not uploaded or archived by this phase. A separate object-storage and document-ingestion phase would be needed for those.

### Knowledge API

- GET /api/knowledge?q=<query> — list or search the authenticated Knowledge Library.
- POST /api/knowledge — add a user-authored note or explicitly saved research item.
- PATCH /api/knowledge/:id — mark a saved web-research item as reviewed by the user.
- DELETE /api/knowledge/:id — delete a saved knowledge item.

## Persistent data

Neon PostgreSQL is used when `DATABASE_URL` is configured. Otherwise, local development uses the JSON state file. Chat transcripts are deliberately excluded from both persistent stores. Memories, tasks, structured feedback, user-approved response preferences, approved workflows and bounded workflow execution history, devices and manually saved research use the persistent app state.

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
