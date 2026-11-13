# JARVIS — voice assistant with selective memory

JARVIS is a private, single-owner assistant with a web dashboard and an Android Companion. It combines a provider-independent AI chat/planning adapter, SearXNG-based live search, optional secure full-page reading, temporary chat context, explicitly requested long-term memories, and consent-based Android controls. A built-in offline brain remains available as a limited fallback.

## How JARVIS handles information

- **Ordinary chats are temporary.** With `DATABASE_URL` configured, JARVIS stores up to 32 messages per conversation in shared Neon tables and expires them after one hour of inactivity. Without a database, local development uses process memory. Chat messages are never written into the durable `jarvis_app_state` snapshot or JSON state file.
- **Long-term memory is selective.** JARVIS saves a preference or fact only when the user explicitly says something like "Remember that I prefer concise Hinglish explanations" or "Yaad rakhna: ...". The Memory screen can review and delete saved notes.
- **Secrets and sensitive personal details are rejected.** Do not ask JARVIS to store passwords, PINs, OTPs, API keys, bank/card details, medical information, home addresses, phone numbers or email addresses.
- **Internet research is not memory.** Relevant current/time-sensitive prompts and explicit requests to check the internet can be routed to the server-configured SearXNG search provider. Optional AI synthesis is separate. When enabled, users can read full HTTPS webpages from returned search sources; page text remains untrusted and is never saved automatically.
- **Tasks, explicitly saved research and approved memories** remain in the persistent app state. These are separate from ordinary chat transcripts.

## Memory and Personal Data Controls (Phase 3)

- Temporary conversation turns expire after one hour of inactivity and are kept separate from the durable personal-data snapshot. Neon-backed deployments use the shared runtime chat table; local development without a database uses process memory.
- Durable memories are saved only through an explicit “Remember / Yaad rakhna” instruction or the Memory form. Ordinary chat is never automatically promoted to long-term memory.
- Memory entries support preference, goal, and fact categories; the Memory screen supports keyword/category search, edit, and delete.
- Duplicate detection normalizes Unicode, casing, and repeated whitespace. The server also rejects likely credentials and sensitive personal records.
- Only a small number of relevant saved memories are supplied to the configured AI conversation context. Unrelated memories are not sent with every prompt.
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
- Only approved, safe, trigger-matching skills are supplied as optional guidance to configured AI chat. They cannot override system/safety instructions or authorize external actions.
- Legacy saved skills are migrated to version 1 to preserve their existing content. Skills created before application targeting default to the global `*` scope, retaining their previous behavior.
- Each version has an explicit application scope: `*`, `web-dashboard`, `android-companion`, or up to 12 stable lower-case application/package IDs (for example, `com.android.chrome`). Editing a version preserves its existing scope unless the user explicitly changes it.
- Trigger matching is evaluated only within the requested application scope. The server binds dashboard chat to `web-dashboard` and rejects attempts to claim another surface. An authenticated paired Android client reports only the current Accessibility active-window package ID; the server validates that metadata and falls back to `android-companion` when it is unavailable. The package ID selects optional guidance only; it is not an authorization or permission token.
- The Skills screen displays and edits application targets. The authenticated `POST /api/skills/preview` endpoint reports which already-approved skills match a message and application ID without executing them.
- The offline rule-based brain cannot interpret arbitrary skill instructions; without a configured conversational AI model, skills are stored and validated but are not executed as open-ended reasoning.

### Skill API

- GET /api/skills — list skills, application-surface catalog and limits.
- POST /api/skills/preview — preview approved trigger matches for a message and application ID; read-only and static.
- POST /api/skills — create a draft (optional `applicationIds`; omitted targets preserve legacy global behavior).
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
- Only user-approved active preferences are included as optional guidance in configured AI conversation context. They cannot override system/safety rules, act as factual evidence, or authorize external actions.
- Response preferences do not train model weights. There is no automatic fine-tuning or hidden prompt rewriting from ratings.
- The offline rule-based brain does not interpret open-ended response preferences. They are applied only when the independent AI provider is configured and enabled.
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
- Workflow steps execute in order. A failed step stops later steps. Each run keeps a bounded step log, safe result summaries and status.
- Failures are classified into transient connection/timeout/rate-limit errors, configuration or credential problems, permission failures, capacity limits, invalid requests and unknown failures. Saved failure summaries use fixed safe messages; raw provider/exception text is not persisted in the recovery record.
- Only classified transient failures can be retried. A retry is a separate user-confirmed action, replays only the failed step with its stable execution key, preserves completed steps and is limited to three attempts. Missing credentials, disabled integrations, permission errors, capacity limits, invalid requests and unknown failures require the cause to be fixed or reviewed; they are not retryable.
- Restart recovery pauses active runs at the last durable checkpoint. Users must review the saved progress and explicitly resume; no action is automatically replayed after a restart. Review checkpoints still require explicit Continue.
- Users can continue a run at an explicit review checkpoint or stop it. Workflows can also be paused or deleted. There is no general automatic repair or background retry loop.
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
- GET /api/workflow-runs/:id/recovery — read a sanitized, non-mutating recovery preview.
- POST /api/workflow-runs/:id/retry — explicitly retry a classified transient failed step (maximum three attempts).
- POST /api/workflow-runs/:id/resume — explicitly resume a paused run from its durable checkpoint.
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
- Phase 13 moves general chat and the Android request planner to a provider-independent OpenAI-compatible chat-completions adapter. It requires `JARVIS_AI_BASE_URL`, `JARVIS_AI_MODEL`, `JARVIS_AI_API_KEY` for remote endpoints, `JARVIS_AI_ENABLED=true`, and the relevant chat/planner opt-in. These server values must be configured privately; the current production deployment has not been given a provider endpoint or credential, so general online answers and AI planning remain unavailable until configured.
- Phase 14 replaces the legacy grounded-search adapter with a server-configured SearXNG JSON search connector. It requires `JARVIS_SEARCH_BASE_URL` and `JARVIS_SEARCH_ENABLED=true`; an optional `JARVIS_SEARCH_API_KEY` can protect a private instance. The current production deployment has not been given a search endpoint, so live internet search remains unavailable until configured.
- Knowledge entries and memories are saved only through explicit user actions; retrieved web pages are untrusted reference material, not instructions or model training.

## Knowledge Library (Phase 2)

- The Knowledge screen is separate from personal Memory, ordinary temporary chat, and the Saved Research history.
- Add a note manually or choose **Save to Knowledge** on a web research result. Internet results are never stored automatically.
- Each saved item keeps its title, content, category, tags, source links, available claim-level citations, and review status.
- Web-research entries start as **unreviewed**. You can mark them as reviewed after checking the source links; this records your action and does not mean JARVIS independently verified every claim.
- JARVIS detects exact normalized title/content duplicates, supports local keyword search, and retrieves a small number of relevant entries as reference context for the configured AI provider or the offline fallback.
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

## Independent AI Brain (Phase 13)

- General chat and Android request planning use a provider-neutral OpenAI-compatible `/chat/completions` adapter built on Node's native `fetch`; chat and planner no longer import the Google model SDK.
- The adapter is configured only through server environment variables. Browser requests cannot select the provider URL, model, API key, headers, or tools.
- Remote endpoints must use HTTPS and an API key. HTTP is accepted only for loopback localhost in non-production environments. Redirects are rejected, requests are bounded by a timeout, retries are limited to transient failures, and provider response bodies are never copied into user-facing errors.
- Conversation context uses standard `system`, `user`, and `assistant` roles with bounded history. Existing approved memories, Knowledge Library excerpts, approved skills, and approved response preferences remain bounded context.
- Android planning requests JSON-mode output and still passes every candidate through the existing local allow-list and protected-action validator. The model cannot execute device actions itself.
- Configure privately: `JARVIS_AI_BASE_URL` (base URL ending before `/chat/completions`), `JARVIS_AI_MODEL`, `JARVIS_AI_API_KEY` for remote endpoints, `JARVIS_AI_ENABLED=true`, and `JARVIS_AI_CHAT_ENABLED=true` and/or `JARVIS_AI_PLANNER_ENABLED=true`. Timeout/retry bounds use `JARVIS_AI_REQUEST_TIMEOUT_MS` and `JARVIS_AI_RETRY_ATTEMPTS`.
- The production endpoint and credential are not configured by this code change. Until a compatible service is configured, JARVIS safely uses its limited offline fallback.
- Phase 14 supplies provider-independent live search results. Search snippets are untrusted evidence; they are not full webpage reads or model training. Saved memories and Knowledge Library entries remain user-controlled context.

### Example configuration (server environment only)

```dotenv
JARVIS_AI_BASE_URL=https://your-compatible-service.example/v1
JARVIS_AI_API_KEY=your-private-key
JARVIS_AI_MODEL=your-model-id
JARVIS_AI_ENABLED=true
JARVIS_AI_CHAT_ENABLED=true
JARVIS_AI_PLANNER_ENABLED=true
JARVIS_AI_REQUEST_TIMEOUT_MS=25000
JARVIS_AI_RETRY_ATTEMPTS=2
```

Do not put real credentials in the repository, browser settings, chat messages, or screenshots.

## Provider-Independent Web Search (Phase 14)

- Live research uses a server-configured SearXNG JSON endpoint. The browser sends only a question; it cannot supply a URL, choose a search engine, change SafeSearch level or control outbound headers.
- The endpoint is configured with `JARVIS_SEARCH_BASE_URL`. Remote production endpoints must use HTTPS; loopback HTTP is permitted only in non-production development/test. Redirects are rejected.
- Search requests use general results, SafeSearch level 2, bounded timeouts and a limited number of retries. Response size, result count, snippet length, and source count are capped. Search credentials, if needed for a private instance, remain in the server environment.
- Search results are normalized to unique HTTPS URLs only. Titles/snippets/published dates are treated as untrusted data. AI synthesis is optional and uses the separately configured Phase 13 provider; when no AI endpoint is ready, JARVIS returns clearly labelled search-result snippets rather than inventing a synthesized answer.
- When AI synthesis is available, it is instructed to cite only supplied source numbers. Claim-level citations are retained only when the answer contains a valid reference marker that maps to one of the supplied HTTPS sources.
- This phase searches result indexes and snippets. It does not download or parse full webpages, crawl links, train model weights, or save results automatically. Full-page reading is a separate later capability.
- Unsafe requests are filtered before an outbound search. Retrieved text is untrusted and cannot authorize device actions or override JARVIS instructions.

### Configure live search (server environment only)

```dotenv
JARVIS_SEARCH_BASE_URL=https://your-trusted-searxng-instance.example
JARVIS_SEARCH_API_KEY=
JARVIS_SEARCH_ENABLED=true
JARVIS_SEARCH_TIMEOUT_MS=12000
JARVIS_SEARCH_RETRY_ATTEMPTS=2
JARVIS_SEARCH_MAX_RESULTS=8
JARVIS_SEARCH_LANGUAGE=all
```

Use a SearXNG instance that you operate or trust. Do not point this setting at a URL supplied by a chat message or search result. Production is not live-search-enabled until this endpoint is configured and `/api/health` reports `searchProvider.enabled=true`.

## Current roadmap Phase 15 — Full Android Task Integration

The current 32-phase roadmap uses Phase 15 for unifying Android task planning and execution across Orb typed input, one-shot voice and hands-free voice. The earlier component-level README milestone labelled full-page reading as Phase 15; that historical feature remains implemented separately and is not the Phase 15 item in the current roadmap.

- Typed Orb and one-shot voice requests resolve local commands on a background executor, then use the authenticated device planner for remaining requests.
- The server returns one of three bounded modes: conversation, clarification or device action. Conversation and clarification plans must contain no actions.
- Device-action plans are checked again on-device against the small action allow-list and shared UiActionPolicy. A screen-action plan is blocked before execution when the user has not enabled JARVIS Accessibility.
- Orb and one-shot voice device-action plans use a visible review dialog and an explicit Approve and run choice. Hands-free voice uses its existing spoken plan preview and explicit approve plan or cancel plan decision. Neither path executes actions before approval.
- Approved tasks run through the same on-device AgentPlanRunner and bounded CancellableActionSequence used by hands-free voice. The local task journal stores generic action categories and step status only; typed content and screen text are not stored in this journal.
- A process-wide execution gate prevents a second Orb or voice task from starting while another task is active. The Orb provides Pause, Resume and Cancel controls; hands-free keeps its spoken task controls.
- The engine still cannot send or submit messages, delete data, purchase, pay, transfer funds, enter credentials, grant permissions, install apps, run arbitrary code or tap screen coordinates. Search-result and other consequential choices remain with the user.
- If the server planner is unavailable, JARVIS uses its existing chat fallback; it does not silently invent or execute a device-action plan.
- Physical Samsung Galaxy Tab A9 acceptance remains the separate Phase 31 hardware validation milestone.

## Historical milestone — Full-Page Reading & Research

This heading retains an earlier component-sequence label. In the current 32-phase roadmap, Phase 15 is Full Android Task Integration, described above. The page-reading capability itself remains unchanged.

- Each live search source can receive a short-lived signed token tied to the authenticated JARVIS session. The read API accepts that token, not a browser-selected URL or arbitrary request headers.
- Only HTTPS URLs on port 443 are eligible. DNS is resolved to IPv4, every returned address must be public, and the request is pinned to a validated address to reduce DNS-rebinding/SSRF risk.
- Redirects, private/reserved/link-local/multicast IPs, IPv6-only targets, compressed responses, PDFs and binary content are rejected. Request duration, response bytes and extracted characters are bounded.
- HTML extraction removes scripts, styles, embedded frames, forms and navigation-oriented markup before presenting plain text. Page titles, metadata, source URL and retrieval time are retained.
- The optional Phase 13 AI provider may summarize the extracted page. Retrieved page text is untrusted prompt-injection material; AI is instructed to use only page evidence, cite the page, and ignore embedded instructions.
- Reading is off by default and must be explicitly enabled with `JARVIS_PAGE_READ_ENABLED=true`. It does not crawl links, execute page code, auto-save content, train model weights or read PDF files in this phase. A user must explicitly choose “Save page to Knowledge” to retain a bounded summary.

### Configure full-page reading (server environment only)

```dotenv
JARVIS_PAGE_READ_ENABLED=true
JARVIS_PAGE_READ_TIMEOUT_MS=15000
JARVIS_PAGE_READ_MAX_BYTES=2000000
JARVIS_PAGE_READ_MAX_CHARS=30000
```

The read controls appear only on live search source cards after page reading is enabled. Tokens expire after 15 minutes and are bound to the login session.

## Source-Based Answer System (Phase 16)

- The Research screen lets you select two to five recent search sources and request a source-based answer.
- The backend accepts only short-lived, session-bound Phase 15 page-read tokens; it never accepts arbitrary URLs from the browser.
- Selected pages are retrieved with the Phase 15 safe reader. At least two pages must be read successfully before synthesis can run.
- The provider-independent AI adapter receives bounded excerpts and returns structured findings, agreements, differences and uncertainties with source numbers.
- The server discards unknown source numbers and maps every accepted citation to the exact HTTPS page that was read.
- If the configured AI provider is missing or unavailable, JARVIS shows the extracted source excerpts and clearly states that no combined AI answer was generated.
- Weak or missing evidence is surfaced as uncertainty. If no validated findings remain, JARVIS does not invent an answer.
- Nothing is automatically saved to Memory or Knowledge, and no model weights are trained.
- Full implementation and verification details: `docs/PHASE16_SOURCE_BASED_ANSWERS.md`.

## Historical component milestone — Persistent Knowledge Learning (earlier sequence)

> This heading retains an older component-level phase number. The current 32-phase roadmap defines Phase 17 as the Media and Content Creation Engine; see docs/JARVIS_PHASE_ROADMAP.md.

- Uses the existing Neon-backed `jarvis_app_state` JSONB store (with the existing local file fallback); no second database is created.
- Saves capture, publication and retrieval dates, source titles, canonical HTTPS URLs, available snippets and claim-level citations.
- Exact duplicate saves merge new provenance into the existing record instead of creating duplicate entries.
- Web research has explicit `unreviewed`, `user-reviewed` and `rejected` states. Only user-authored notes and web research explicitly reviewed by the owner enter assistant knowledge context.
- The Knowledge screen provides filters and review/reject/reopen controls.
- A Phase 16 source-based answer can be saved only after the user clicks the save action. It starts unreviewed; nothing is silently saved or used for model training.
- Full implementation and API behavior: `docs/PHASE17_PERSISTENT_KNOWLEDGE.md`.

## Natural Voice Conversation (Phase 18)

- Browser and Android Companion voice output is language-matched for Hindi (India) or English (India).
- The browser Voice settings let you choose an available voice, adjust output speed, enable/disable spoken replies and stop current playback.
- Long browser replies are split into sentence/word-bounded chunks and played sequentially. New input and Stop speaking cancel the queued reply.
- Browser voice selection prefers an installed/local language-matched voice when the browser exposes that capability.
- Android Companion prefers an installed, offline language-matched TTS voice. Long replies are queued in bounded chunks rather than being cut off at the old text limit.
- The Android foreground-service notification exposes separate Interrupt speech and Stop actions. Starting a new one-shot request stops earlier TTS output.
- Microphone capture remains user-started. Browser/Android recognition uses the selected browser or Android speech service; recognized text, not raw microphone audio, goes to JARVIS over the existing HTTPS API.
- No always-on microphone, wake-word, background hidden listening, full-duplex streaming or VAD is introduced.
- Full implementation and limitations: `docs/PHASE18_NATURAL_VOICE.md`.

## Intelligent Conversation Memory & Context (Phase 19)

- Long-term memory remains explicit: JARVIS saves a note only after a direct Remember / Yaad rakhna request or an intentional save in the Memory screen. Ordinary chat is temporary and is never silently promoted to memory.
- Each saved note can be edited, deleted, or paused/resumed for assistant context. Pausing keeps the note in the Memory list but excludes it from online AI prompts.
- The Memory screen includes a temporary context preview. Enter a prompt to inspect which enabled notes match, their relevance ranking, and how many matching paused notes were excluded. Preview text is not saved.
- Retrieval filters common English and Hinglish/Hindi filler words, matches meaningful terms and safe word variations, and requires a minimum relevance overlap. Up to 5 enabled notes and 1,800 total characters are included with an online AI request; unrelated and paused notes are excluded.
- A chat forget request must include the exact saved note, for example: `Forget: I prefer concise Hinglish explanations` or `Bhool jao: I prefer concise Hinglish explanations`. Only an exact normalized match deletes one note. Vague, partial, and bulk requests delete nothing; the user can still edit/delete notes in the Memory screen.
- Memory screening rejects likely credentials, contact details, medical/health details and other sensitive personal categories. This screening is a safeguard, not a guarantee; do not save secrets or sensitive personal information.
- The existing Neon-backed `jarvis_app_state` store remains the source of durable data. No new database or model training is introduced.
- Full behavior and verification: `docs/PHASE19_INTELLIGENT_MEMORY.md`.

## Android Device Control (Phase 20)

- The Android Companion supports locally executed app launch, explicit on-device screen summaries, scrolling, Back, Home, exact visible-label taps, and ordinary text entry into a field the user has already focused.
- When the server AI planner is not configured, a built-in deterministic rules planner (without an external AI provider) can still handle clear app-search requests such as `Open YouTube and search for JEE Physics`, `YouTube kholo aur JEE Physics search karo`, or `Search for circular motion on YouTube`.
- That offline workflow is deliberately short: open the named app, tap its visible **Search** control, type the requested search phrase, then stop and ask the user to select the result. JARVIS does not choose a result automatically.
- The fixed-pattern planner does not need an external AI key, but the multi-step request still needs an active network connection to the authenticated JARVIS server and a paired device. Direct commands already recognized by the Android Companion can run locally without pairing.
- Screen summaries are read locally on the tablet and are not sent to the server. Accessibility must be enabled manually by the user in Android Settings; microphone use remains within an explicitly started session.
- Password, PIN, OTP, verification, send/submit, delete, payment/purchase, transfer, account-security and permission controls remain blocked. A conservative search-term filter also declines selected high-risk searches; it is not a guarantee that every unsafe request can be detected.
- Unsupported or ambiguous requests are not guessed. Broader AI planning remains optional and requires a separately configured server-side AI provider. A paired device, an enabled microphone and Accessibility permission do not by themselves guarantee general-purpose AI or unrestricted device control.
- Full behavior and limitations: `docs/PHASE20_ANDROID_DEVICE_CONTROL.md`.

## Interruptible Android Task Execution (Phase 21)

- The Android Companion now treats each multi-step device plan as a cancellable sequence with a maximum of six actions.
- The visible notification action **Interrupt / cancel task** cancels the queued remainder of the current device plan, stops speech, and returns the active session to listening.
- **Stop** cancels queued device actions, invalidates pending responses from the previous voice turn, ends speech recognition, and stops the foreground voice session.
- New voice turns, service destruction and removal of the app task also invalidate older work. Late planner/chat responses from an older turn are ignored instead of being spoken or executed.
- A failed step or an explicit user checkpoint ends the sequence immediately. Cancellation does not roll back an action that Android already completed; it prevents later queued steps.
- The planner's HTTP request is not forcibly terminated by interruption, but its late response is discarded and cannot start another action sequence.
- The Android CI now runs JVM unit tests for sequential completion, queued-step cancellation, cancellation before first dispatch, user checkpoints and failed-step stopping before building the APK.
- Full behavior and limitations: `docs/PHASE21_INTERRUPTIBLE_ANDROID_TASKS.md`.

## System Readiness & Final Integration (Phase 22)

- The authenticated **System Status** dashboard calls `GET /api/diagnostics` to inspect the primary data store, temporary chat storage mode, AI conversation and planner capabilities, live search, full-page reading, source-based answers, Google Drive OAuth readiness, external integration configuration and Android Companion pairing.
- The diagnostics report distinguishes a ready, warning or error state. A configured provider is not described as connected unless a stored connection is actually present; integration configuration is not treated as a successful live provider test.
- When Neon is configured, the endpoint performs a small read-only check of the JARVIS application-state record. Without Neon, it checks that the local JSON state file is accessible and warns that persistence depends on the host filesystem.
- Temporary chat history is reported separately because the no-Neon fallback uses process memory and is cleared when the server restarts.
- Diagnostics never performs live web searches, sends Telegram messages, reads Google Drive files, generates ElevenLabs audio, creates external documents or changes Android settings. Use the existing Connections test buttons when you explicitly want to contact a provider.
- The response contains capability flags and aggregate counts only. It does not reveal credentials, tokens, encryption keys, database URLs, raw server paths or environment-variable values.
- The endpoint requires an authenticated JARVIS session and is rate limited. The public `/api/health` endpoint remains separate and does not expose the detailed private workspace inventory.
- Full behavior and limitations: `docs/PHASE22_SYSTEM_READINESS.md`.

## Built-in offline mode

The offline brain is not a general-purpose language model. It contains a safe arithmetic parser, deterministic rules and a curated knowledge pack for selected topics such as Newton's laws, units and dimensions, mole concept, sets, circular motion and Ohm's law. It cannot answer arbitrary questions. Live web retrieval requires a trusted SearXNG endpoint configured on the server.

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
- Keep `JARVIS_PASSWORD`, `DATABASE_URL`, `JARVIS_AI_API_KEY` and any private `JARVIS_SEARCH_API_KEY` confidential.
- Review Android permissions yourself and enable only what you understand and need.
- Treat model outputs as fallible. Verify important claims against the linked sources or trusted people.


## Phase 23 — Google-preferred web search and JARVIS-owned model runtime

- Live search uses the configured SearXNG server and requests Google first, with DuckDuckGo and Bing as configured fallback engines (`JARVIS_SEARCH_ENGINES=google,duckduckgo,bing`). SearXNG must have those engines enabled. The JSON format must also be enabled; a public instance may disable it, so production must use a tested trusted instance or self-hosted SearXNG.
- Google is an engine behind the search adapter, not a direct Google API integration. Google's Custom Search JSON API is closed to new customers and its existing-customer transition ends 1 January 2027; do not assume a new project can obtain that API.
- The AI adapter supports `JARVIS_AI_RUNTIME=self-hosted` for an owner-controlled inference endpoint that speaks the OpenAI-compatible chat-completions protocol. It can connect to a compatible Ollama/vLLM server behind private HTTPS and server-side authentication. Endpoint, API key and model name remain server-only.
- `self-hosted` means the inference server is controlled/hosted by the JARVIS owner; it does not mean the base model was trained from scratch. A genuinely JARVIS-trained foundation model requires a separate dataset, training/evaluation pipeline, model-artifact storage and compute. Saved memories and feedback do not silently train model weights.
- Vercel hosts the web application, not a large LLM's model weights. A self-hosted model endpoint must run on a separate always-on machine/server with sufficient RAM/accelerator capacity and be exposed only through authenticated HTTPS. Never put provider keys in the browser or Git.
- `JARVIS_AI_RUNTIME` accepts `self-hosted` or defaults safely to `external`. Existing AI enable flags remain off until a real model endpoint has been connected and explicitly tested.

## Current 32-phase roadmap — Phase 19: Independent Learning

The older component-milestone headings in this README are retained for historical context. The current `docs/JARVIS_PHASE_ROADMAP.md` defines Phase 19 as Independent Learning.

- Teach one lesson deliberately in chat: `Learn: <title> | <lesson>`, `Teach JARVIS: <title> | <lesson>`, or `Sikhao: <title> | <lesson>`.
- Only these explicit prefixes create a saved learning entry; ordinary conversation, user questions, ratings and web results are not silently promoted to knowledge.
- A lesson is saved in the existing Knowledge Library as a user-authored note, with the existing privacy and duplicate checks. Chat lessons are limited to 500 characters.
- Ask a normal question later and the offline assistant can retrieve up to three relevant user-authored or user-reviewed notes. Unreviewed/rejected web research remains excluded.
- The Knowledge page includes a read-only preview of the relevant offline context. It does not send the preview to an AI provider or store the preview prompt.
- This is transparent retrieval learning. It does not retrain model weights, automatically fact-check lessons, or guarantee semantic reasoning. Physical Galaxy Tab A9 acceptance remains Phase 31.

Full contract: `docs/JARVIS_PHASE_19_INDEPENDENT_LEARNING.md`.


## Current 32-phase roadmap — Phase 20: Knowledge Manager

The current `docs/JARVIS_PHASE_ROADMAP.md` supersedes historical component labels in this README. Phase 20 is the Knowledge Manager.

- Upload TXT, Markdown, CSV and JSON files for validated UTF-8 text indexing and offline search.
- Store PDF, JPEG, PNG, WebP, MP3, M4A, WAV, OGG, WebM and MP4 files as managed attachments with metadata, collections and tags.
- Search/filter by title, extracted text, description, collection, tags and review status; edit metadata, download, approve, reject, reset review or delete.
- File content is checked against the declared MIME type and file signature. Filenames are reduced to a safe basename; server storage keys are generated IDs. Maximum 15 MiB per file, 120 records and 200 MiB aggregate.
- All imports begin unreviewed. Only explicitly user-reviewed text or descriptions can enter assistant context. Editing metadata resets the review state. If online AI is enabled, approved context may be sent to the configured provider; disable online AI to use the built-in offline retrieval path.
- No automatic OCR, PDF text extraction, image understanding, audio transcription or video transcription is included. These files are attachment-only in this phase; user descriptions are searchable.
- Binary bytes are stored in a server filesystem directory; metadata is stored with the existing state/Neon data. Set `JARVIS_DOCUMENTS_DIR` (or `JARVIS_DATA_DIR`) to a durable mounted volume in production. Neon alone does not persist uploaded file bytes.
- Binary attachments are excluded from the JSON data export; download each attachment separately.

Implementation contract: `docs/JARVIS_PHASE_20_KNOWLEDGE_MANAGER.md`. Physical Galaxy Tab A9 file-picker/download testing remains Phase 31.


## Canva Connect design automation (feature branch)

There are two separate Canva control paths:
- **Android UI control** does not require Canva OAuth. It operates only the selected Canva app's visible, exact accessible controls; the user selects the design element, chooses files, and verifies the final result.
- **Optional Canva MCP design editor** requires a Canva developer app, the existing JARVIS Canva OAuth client settings, and the encrypted token vault. It adds supported design-element edits via reviewable transactions, but does not unlock arbitrary video timeline trimming, keyframes, or audio-track editing.

- Canva OAuth now requests design metadata/read, design content read/write, brand-template metadata/content read, and asset read/write scopes. Existing thumbnail-only connections remain recognizable but must be reauthorized to enable the expanded automation.
- The Creator Studio can list Canva designs and brand templates, inspect design/template data sets, create a design from a brand template or compatible existing design, update compatible template-backed fields on an existing design, and submit/poll export jobs including MP4, PNG, PDF, JPG, GIF and PPTX.
- Autofill field values are explicit typed JSON supplied and reviewed by the user. Image/video fields require an asset ID that already exists in Canva; JARVIS does not invent an uploaded asset ID.
- Create, update and export requests require a separate confirmation in Creator Studio. Export download URLs are temporary and should be saved promptly.
- This is Canva Connect API automation, not unrestricted editing of every element or arbitrary timeline operation. Precise clip trimming, splitting, keyframes, audio track layout and canvas gestures are not exposed through this external API. Android Accessibility remains a separate, conditional UI-control path.
- Brand-template/autofill availability depends on the connected Canva account and plan, and the Canva developer integration must allow the requested scopes.

## Background voice session (feature branch)

- The user must start microphone control while JARVIS is visible and microphone permission is granted. The ongoing Android microphone foreground service has a persistent notification with Interrupt and Stop actions.
- The service can continue when the user leaves JARVIS or dismisses its task from Recents. The user can stop it from the notification.
- This is not an ambient always-on acoustic wake-word engine. The current `Hey JARVIS` gate is evaluated after Android speech recognition returns text. The service does not auto-start after boot and does not silently restart after process death.
- Offline-only mode refuses network speech-recognition/TTS fallback when local services or language models are missing. Background service and language behavior still require physical-device acceptance.

## Android workspace status

- The Android Companion has native Orb, setup/pairing, voice controls, local encrypted memory and a WebView-hosted JARVIS Workspace.
- The full dashboard is **not yet a fully native Android workspace**. Converting Chat, Workflows, Research, Knowledge, Creator Studio, Media Studio, integrations and diagnostics into native Android screens with native offline parity remains separate work; this feature branch does not claim that conversion is complete.

## External editor and Canva project harvest

- JARVIS's original Media Studio now has a browser-local IndexedDB library for reusable image/video/audio files, tags, search and reattaching saved assets to clips in the same browser profile.
- Timeline moves and trims use magnetic snap points from nearby clip boundaries and the playhead.
- Android hands-free commands can toggle selected Canva text formatting, set a bounded font size, and open the selected-media Replace control when the installed Canva app is foregrounded. File selection and final visual verification remain manual.
- Repository license and compatibility decisions are recorded in [JARVIS repository feature harvest](docs/JARVIS_REPOSITORY_FEATURE_HARVEST.md).

## Android release and final acceptance

Main includes the advanced multitrack Media Studio, bounded Canva accessibility drag support, and Creator Campaign Studio. See [JARVIS release and acceptance status](docs/JARVIS_RELEASE_AND_ACCEPTANCE.md) for the exact feature boundaries, the signed-APK workflow, required private GitHub Actions secrets, and the physical Galaxy Tab A9 acceptance checklist.

The regular CI workflow produces a **debug** APK for testing. A signed release APK is produced separately by `.github/workflows/release-android.yml` after the owner configures the four Android signing secrets. A green CI build is not proof of physical-device or Canva UI acceptance.

