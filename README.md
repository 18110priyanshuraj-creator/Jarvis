# JARVIS — voice assistant with selective memory

JARVIS is a private, single-owner assistant with a web dashboard and an Android Companion. It combines server-side Gemini conversation, Google Search grounding for relevant current questions, temporary chat context, explicitly requested long-term memories, and consent-based Android controls. A built-in offline brain remains available as a limited fallback.

## How JARVIS handles information

- **Ordinary chats are temporary.** With `DATABASE_URL` configured, JARVIS stores up to 32 messages per conversation in shared Neon tables and expires them after one hour of inactivity. Without a database, local development uses process memory. Chat messages are never written into the durable `jarvis_app_state` snapshot or JSON state file.
- **Long-term memory is selective.** JARVIS saves a preference or fact only when the user explicitly says something like "Remember that I prefer concise Hinglish explanations" or "Yaad rakhna: ...". The Memory screen can review and delete saved notes.
- **Secrets and sensitive personal details are rejected.** Do not ask JARVIS to store passwords, PINs, OTPs, API keys, bank/card details, medical information, home addresses, phone numbers or email addresses.
- **Internet research is not memory.** Relevant current/time-sensitive prompts and explicit requests to check the internet can be routed to Google Search grounding. Responses show available source links. A search result is used to answer the current question and is not saved as a long-term memory or research record automatically.
- **Tasks, explicitly saved research and approved memories** remain in the persistent app state. These are separate from ordinary chat transcripts.

## Memory and Personal Data Controls (Phase 3)

- Temporary conversation turns expire after one hour of inactivity and are kept separate from the durable personal-data snapshot. Neon-backed deployments use the shared runtime chat table; local development without a database uses process memory.
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
- GitHub, Telegram and ElevenLabs credentials are read from server environment variables. Google Drive refresh tokens use the encrypted server-side vault added in Phase 8. Credentials are never entered into browser forms, workflow definitions, run logs or data exports.
- All provider requests use fixed HTTPS endpoints and GET only, with an eight-second request timeout, redirect blocking, safe response summaries, and no raw provider error bodies returned to the dashboard.
- GitHub: checks repository metadata access and can list up to eight recently updated repositories. For a fine-grained personal access token, grant only **Metadata: read** for the repositories you select.
- Google Drive: lists up to eight recent file metadata records. Phase 7 supports a legacy short-lived access token; Phase 8 adds OAuth authorization, encrypted refresh-token storage and automatic access-token refresh.
- Telegram: checks the configured bot profile using the read-only getMe endpoint. It does not send messages.
- ElevenLabs: reads a limited account/subscription summary. It does not generate audio or consume generation credits.
- Each provider can be tested from the Connections dashboard. A configured credential does not mean the provider has been verified; use **Test connection** to check it.
- Connections can be disabled/re-enabled inside JARVIS. Disabling blocks future tests and workflow actions; to revoke a credential fully, remove it from the host environment and rotate it at the provider. The disabled-provider IDs are part of the user's data export; credential values remain excluded.
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
- POST /api/integrations/:provider/test — test one enabled, supported connection and return a limited sanitized profile/summary.
- POST /api/integrations/:provider/disable — block future connection tests and workflow actions for that provider inside JARVIS.
- POST /api/integrations/:provider/enable — allow that configured provider to be used by JARVIS again.
- Disabling is not provider-side token revocation. Remove/rotate the credential in the hosting environment and revoke it with the provider for full revocation.
- Supported workflow actions: `github_list_repositories`, `google_drive_list_files`, `telegram_get_bot_profile`, `elevenlabs_get_account`.

## OAuth, Encrypted Token Vault and Permission Management (Phase 8)

- Google Drive uses the authorization-code flow with PKCE S256 and a one-time state value bound to the browser and authenticated JARVIS session. Pending state expires after ten minutes and exists only in server memory.
- The only Google permission requested is https://www.googleapis.com/auth/drive.metadata.readonly. JARVIS lists file names and metadata; it does not request Drive file contents or write access.
- The refresh token is encrypted at rest with AES-256-GCM using JARVIS_TOKEN_ENCRYPTION_KEY. The encryption key is not stored beside the ciphertext. Access tokens are held in process memory, refreshed before expiry, and never written to the persistent state snapshot.
- If Google rotates the refresh token, the replacement is encrypted and persisted. A single in-flight refresh per provider avoids duplicate refresh requests.
- Configure JARVIS_GOOGLE_OAUTH_CLIENT_ID, JARVIS_GOOGLE_OAUTH_CLIENT_SECRET, JARVIS_GOOGLE_OAUTH_REDIRECT_URI and JARVIS_TOKEN_ENCRYPTION_KEY in private server environment settings. The callback URI must exactly match the URI registered in the Google OAuth client and use HTTPS in production.
- The encryption key must remain stable and backed up. Changing or losing it makes an existing stored refresh token undecryptable; reconnect Google Drive after replacing a lost key.
- The Connections view shows OAuth readiness, connection state and requested/granted permission scopes. Revoke Google access explicitly from the dashboard; JARVIS calls Google's revocation endpoint and removes its encrypted local copy after a successful or already-invalid response.
- Google token revocation removes OAuth scopes previously granted to the same Google Cloud project and invalidates issued tokens for all clients registered under that project. Use a dedicated Google Cloud project for JARVIS if you want to isolate it. Review the dashboard confirmation before revoking.
- The original JARVIS session cookie remains SameSite=Strict. A separate short-lived, HttpOnly, SameSite=Lax callback-binding cookie is used for Google's top-level OAuth redirect.
- GitHub OAuth Apps are not used because their scopes are not as granular as GitHub App permissions. Use a fine-grained token with Metadata: read or a GitHub App with the minimum required read permission.
- Telegram's bot API uses a bot token, not OAuth. ElevenLabs uses restricted API keys, not OAuth. Their credentials remain server-side and only their existing read-only provider operations are enabled.
- Encrypted OAuth token records are intentionally excluded from /api/state and personal data export. The export contains no refresh token, access token, client secret or encryption key.

### Google Cloud and hosting setup

1. In a dedicated Google Cloud project for JARVIS, enable the Google Drive API and create an OAuth client of type **Web application**.
2. Add this exact authorized redirect URI to the OAuth client: `https://YOUR_PUBLIC_JARVIS_HOST/api/integrations/google_drive/oauth/callback`. The URI in the server environment must match it exactly.
3. Add the OAuth client ID, client secret and redirect URI to the private server environment. Do not put them in browser settings or Git.
4. Generate the token-vault key on your own machine with `openssl rand -base64 32`, then save the output privately as `JARVIS_TOKEN_ENCRYPTION_KEY`. Never send the generated value in chat or commit it.
5. Keep the same encryption key and persistent database/storage across restarts. If the host has ephemeral local storage, configure `DATABASE_URL` or another persistent disk before connecting Google Drive. The current OAuth handshake state is held in the running server process, so complete the consent redirect without restarting or switching server instances.
6. Redeploy/restart JARVIS, open Connections and select **Connect Google Drive**. Approve only the displayed read-only Drive metadata permission, then use **Test connection**.

### OAuth environment variables

- JARVIS_GOOGLE_OAUTH_CLIENT_ID
- JARVIS_GOOGLE_OAUTH_CLIENT_SECRET
- JARVIS_GOOGLE_OAUTH_REDIRECT_URI
- JARVIS_TOKEN_ENCRYPTION_KEY — exactly 32 bytes when decoded from base64 (recommended via `openssl rand -base64 32`), or 64 hexadecimal characters.

### OAuth API

- POST /api/integrations/google_drive/oauth/start — start the PKCE authorization flow.
- GET /api/integrations/google_drive/oauth/callback — validate state/session and exchange the authorization code.
- POST /api/integrations/google_drive/oauth/revoke — revoke the stored Google refresh token and remove the encrypted local connection.

## Controlled External Actions (Phase 9)

- The Action Center adds two fixed provider actions: send one plain-text Telegram message to an allow-listed numeric chat ID, or create a new Google Doc and insert the approved text.
- Creating an action only saves a preview. It never calls the provider. The preview expires after 15 minutes and the user must open it, review the exact destination/content and type the displayed confirmation phrase: `SEND MESSAGE` or `CREATE GOOGLE DOC`.
- Each preview can execute only once. Pending previews can be cancelled. A request that times out or fails after the provider might have received it is marked failed and cannot be retried from that same preview; inspect the provider before creating a new one.
- Telegram sends only the configured chat ID and plain text through the Bot API `sendMessage` method. It does not accept public usernames/channels, bulk targets, HTML/Markdown parsing, paid broadcast options, media, or scheduled delivery. The server rechecks `JARVIS_TELEGRAM_ALLOWED_CHAT_IDS` immediately before sending.
- Google Docs creation requires a separate incremental consent upgrade to `https://www.googleapis.com/auth/drive.file` in addition to the existing metadata scope. This allows JARVIS to create and edit files created by this app; it does not request broad Drive access or edit unrelated existing files. Content is inserted with the Google Docs batchUpdate method.
- No action can be triggered from the normal Workflow Run path. Workflows remain local/read-only for external services; the Action Center is the only place where these two external writes can be confirmed.
- The action audit history is saved in JARVIS and included in the user's personal data export. It contains the user-entered preview text but never provider tokens, OAuth access/refresh tokens, client secrets or the token-vault encryption key.
- Provider actions are rate limited. There is no scheduler, arbitrary URL/action tool, group broadcast mode, content publishing or payment function.

### Phase 9 server environment

- `JARVIS_TELEGRAM_BOT_TOKEN` — private bot credential.
- `JARVIS_TELEGRAM_ALLOWED_CHAT_IDS` — comma-separated numeric chat IDs allowed to receive messages. Keep this list small; do not add public channels or destinations you do not control.
- Google Drive also requires the Phase 8 OAuth client and stable encrypted token-vault key. From Connections, choose the separate **Enable Docs creation permission** consent step.

### External action API

- GET /api/actions/capabilities — provider readiness and allowed Telegram destination IDs.
- GET /api/actions — preview and audit history.
- POST /api/actions — create a preview only; no provider call.
- POST /api/actions/:id/execute — perform one action only after the exact typed confirmation phrase.
- POST /api/actions/:id/cancel — cancel a pending preview.

## Orbital voice interface and Android companion

- The main JARVIS screen is a minimal black interface with one animated orange orbital core, a small status line, a recent conversation area, and a compact text input.
- Tap the orbital core to start browser speech recognition. JARVIS sends the recognized text through the normal chat route, speaks the reply with browser speech synthesis, and listens again while the voice session remains active.
- Tap the orb again, sign out, navigate away from Assistant, or close the page to stop microphone use. There is no wake word and no always-on microphone.
- Browser speech recognition availability and language quality depend on the browser/device. The browser's speech service may process recognition audio; JARVIS does not send raw microphone audio to its server in this mode.
- Hindi/Hinglish is the default input language; English (India) can be selected in the voice controller configuration. The Android Companion remains a separate app with its own pairing, permission and Stop controls.
- Existing Android actions remain restricted to their allow-list and user-confirmed flows. The orbital UI does not grant new device permissions or unrestricted phone control.

## Online AI and web research provider status

- The visual interface and browser speech loop do not depend on a live audio-model stream.
- The existing server-side chat and grounded web-research modules still use the legacy Google model adapter. They require a valid server-only `GEMINI_API_KEY` and their opt-in flags. The production key is currently empty, so open-ended AI answers and live web research are not currently available there; JARVIS falls back to its limited offline rules.
- A separate, age-appropriate provider replacement is required before those online capabilities can be genuinely Gemini-free. Do not claim that JARVIS searched the internet when the server reports that web research is unavailable.
- Knowledge entries and memories are saved only through explicit user actions; retrieved web pages are untrusted reference material, not instructions or model training.

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

## Shared Runtime State (Phase 10)

- When `DATABASE_URL` is configured, login sessions, temporary conversation messages, and pending Google OAuth handshakes use shared Neon PostgreSQL tables. They are no longer tied to one server process.
- `jarvis_sessions` stores a SHA-256 hash of each random session cookie token, never the raw cookie value. The session is renewed while active and expires after 12 hours of inactivity.
- `jarvis_chat_messages` stores a hashed conversation key, message text, bounded source/citation metadata, and an expiry timestamp. Each conversation is limited to 32 messages; activity refreshes the one-hour expiry. Sign-out and Clear Chat remove the relevant records.
- `jarvis_oauth_pending` stores only hashed OAuth state, login-session and browser-binding identifiers. The PKCE verifier is encrypted with the existing `JARVIS_TOKEN_ENCRYPTION_KEY` before persistence. OAuth state expires after ten minutes and is consumed once.
- These tables and their indexes are created automatically during server startup. No manual SQL migration is required for the runtime tables.
- `jarvis_app_state` now has a revision counter. Saves use an atomic revision check; when another server instance wins a concurrent update, JARVIS loads the latest snapshot, merges collection changes by record ID/provider, and retries rather than silently replacing the latest data.
- Without `DATABASE_URL`, the runtime store falls back to process memory for local development. Production deployments that need sessions and conversations to survive across server instances must configure a persistent shared database.

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
