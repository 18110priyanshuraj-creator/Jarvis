# Phase 8 — Local Memory System

## Goal

Add a genuinely on-device, user-controlled memory store to the Android Companion. Keep it separate from the existing server-side Memory screen, Neon application state, and temporary conversation history.

## Android storage

- Uses a separate Room database file, `jarvis_local_memory.db`, with its own version-1 schema.
- Does not alter or migrate the existing `jarvis_core.db` execution journal or server-side app state.
- Memory content is encrypted before it enters Room using AES/GCM/NoPadding and a non-exportable AES key held by Android Keystore. Each encrypted record stores its own random GCM IV.
- The database stores only encrypted content plus the category, enabled flag, SHA-256 content fingerprint, identifier and timestamps. Content is decrypted only when the user opens, searches or explicitly recalls a note.
- Android backup is disabled by the existing application manifest setting. No local-memory API, cloud sync, remote write, export or server import was added.

## User control

The native Setup page opens **Manage on-device memories**. The screen supports add, search, edit, pause/resume and individual deletion. Memory categories are `fact`, `preference` and `goal`.

Only explicit commands or deliberate use of the Add Memory screen save durable notes. Supported command examples:

- `Remember: I prefer concise explanations`
- `Remember preference: I prefer concise explanations`
- `Yaad rakho: I prefer concise explanations`
- `Recall Hinglish explanations`
- `What do you remember about physics?`
- `Forget: [paste the exact saved note]`
- `Bhool jao: [paste the exact saved note]`

Recall is local-only and excludes paused notes. The list screen still shows paused notes so they remain editable and deletable. Forget matches one exact normalized note; vague, partial and bulk requests delete nothing.

## Privacy and limits

- Maximum 200 notes; each note is 3–500 characters.
- Rejects likely passwords, PINs, API keys, bearer tokens, contact details, health information and selected sensitive personal categories. This pattern filter is a safeguard, not a guarantee that every sensitive detail can be detected.
- A note is never silently harvested from a transcript or normal conversation.
- Local notes are never attached to a remote chat or planner request. Explicit Recall displays matching local notes to the user; it does not forward them to the server.
- Server workspace memories and on-device memories remain separate stores. No automatic merge or migration is performed.

## Verification

Automated Android tests cover encrypted payload storage, persistence after database reopen, normalization, duplicate rejection, privacy filtering, bounded content, search ranking, pause/resume, edit, exact-match forget and local command behavior. GitHub Actions remains the final automated gate. Android Keystore behavior and the full flow on a physical Samsung Galaxy Tab A9 remain part of Phase 31 device acceptance.
