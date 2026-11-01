# Phase 13 — Real-time Voice Conversation

## Goal

Build on Phase 12's one-shot browser speech controls with an explicitly started, two-way audio conversation. The browser streams microphone PCM directly to Gemini Live over a WebSocket and plays streamed voice responses. Phase 12's Speak/Stop controls remain available as a fallback.

## Included

- Server-issued Gemini Live ephemeral credentials. The permanent GEMINI_API_KEY is never sent to the browser.
- Tokens are single-use, have a short connection start window, expire quickly, and constrain the Live model and setup.
- Browser microphone capture starts only after the user presses Start live voice. A visible state shows connecting, listening, speaking, or idle.
- Audio is resampled in an AudioWorklet to mono 16-bit PCM at 16 kHz and sent in 20 ms chunks.
- Model audio is decoded as 16-bit PCM at 24 kHz and played as it arrives.
- Server interruption messages stop and clear queued playback so a user can barge in.
- Input and output transcriptions are shown locally while the session is active. They are not posted to JARVIS chat APIs or stored in JARVIS's database.
- A session has a 10-minute client-side maximum. Stop, sign-out, tab close, errors, and timeout release microphone tracks, audio nodes, WebSocket and audio context.
- Live sessions have no tools or device-control capabilities. An unexpected tool request is treated as an error, not executed.

## Configuration

The feature is disabled by default. Set these server-side environment values to opt in:

- GEMINI_API_KEY — existing server-side Gemini API key.
- GEMINI_LIVE_VOICE_ENABLED=true — explicit enable switch.
- GEMINI_LIVE_MODEL=gemini-3.8-live — model override (optional; this is the default).

Never place the API key or ephemeral token in source files, local storage, query strings outside the WebSocket connection, logs, analytics, or error messages. Use HTTPS in deployment; browser microphone access requires a secure context.

## Privacy and safety

The microphone is requested only after a deliberate button press and is stopped when the session ends. Live audio and transcriptions are sent to Google's Gemini Live API for the active conversation. JARVIS does not add them to its temporary chat transcript, durable memories, research, feedback, or exports. This does not make a statement about Google's independent handling of API data; consult the provider's current terms and data settings.

Live voice is conversation-only. It does not inherit JARVIS workflows, integrations, Android controls, file access, or external-action permissions. Ordinary browser chat remains separate.

## Limitations and verification

- Gemini Live is currently documented by Google as a Preview API. Availability, model support, quotas, pricing and behavior may change.
- The app requires a browser supporting WebSocket, AudioWorklet, getUserMedia and Web Audio. A physical Android tablet test with microphone permission and headphones is still required.
- No wake word, always-on listening, background recording, session resume, Android-native Live transport, video input or automatic memory is included.
- Unit tests cover server opt-in, token constraint shape, model safety, PCM encoding/decoding and setup payload. CI must pass before merge. Live provider connectivity and physical mic/playback still require a configured secret and device test.
