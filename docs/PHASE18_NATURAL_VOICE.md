# Phase 18 — Natural Voice Conversation

## Goal

Improve the existing browser and native Android voice paths without introducing a second voice stack, reviving Gemini, or claiming always-on/full-duplex capabilities.

## Browser voice experience

- Keeps the existing one-shot browser speech-recognition flow and the explicit Orbital microphone control.
- Presents user-visible Voice settings: Hindi / Hinglish (India) or English (India), an available language-matched speech voice, slower / normal / faster output speed, spoken-reply toggle and Stop speaking.
- Reads the browser's available speech voices and refreshes the list when the browser fires `voiceschanged`.
- When automatic selection is active, prefers a voice matching the reply language and favours an installed/local voice when the browser exposes that property.
- A manually selected voice is used only when it matches the reply language. Otherwise the controller falls back to a voice that matches the actual reply language.
- Long replies are split into bounded, sequential speech chunks at sentence or word boundaries. The UI returns to idle only when the final chunk completes.
- Starting a new microphone turn, stopping speech, navigating away, or replacing a reply cancels the current speech queue. Generation guards ignore late callbacks from old recognition or speech events.
- Speech rate is bounded and pitch / volume remain at standard defaults.

## Android Companion

- Reuses the existing Android `SpeechRecognizer`, `TextToSpeech`, foreground service and paired-device HTTPS routes.
- Prefers an installed, local voice matching Hindi (India) or English (India). If only a configured system/network voice is available, JARVIS reports that distinction; the TTS provider follows its own privacy settings.
- Uses the reply script to choose Hindi or English output and applies standard speech rate and pitch.
- Long replies are split into bounded chunks and queued in order instead of being truncated at the previous short limit.
- The hands-free foreground-service notification now has separate **Interrupt speech** and **Stop** actions. Interrupt cancels the current speech queue and returns to listening; Stop ends the session and microphone service.
- Starting one-shot recognition stops any Android TTS reply already in progress.
- Companion version is updated to `0.2.0-phase18`.

## Privacy and activation

- Microphone access remains user-started. Browser hands-free mode starts only after tapping the Orb; Android hands-free recognition runs only after explicitly starting its foreground service.
- Android prefers on-device recognition when the device reports it is available. Otherwise the configured Android speech-recognition service may process microphone audio according to that provider's privacy settings.
- Browser speech recognition is provided by the selected browser and may process microphone audio according to browser/device settings.
- JARVIS receives recognized text over the existing authenticated HTTPS routes. This phase does not upload raw microphone audio to the JARVIS server.
- Browser and Android speech synthesis may use local installed voices or a configured system/network voice. The browser prefers local voices when it exposes that capability; Android explicitly prefers non-network voices where installed.
- No always-on microphone, wake-word service, background listening without an active user-started session, voice activity detection or full-duplex audio stream is added.

## Configuration

No new API key, paid service, Gemini SDK, provider account or server credential is required. This phase reuses browser speech APIs and Android's configured SpeechRecognizer / TextToSpeech engines. Voice availability and quality vary by browser, Android version, installed language packs and the selected device speech service.

## Verification

- Node unit tests cover long-text chunking, sequential playback, final state transitions, cancellation of queued chunks, stale callback protection, voice-language matching, local-voice preference, speech rate / pitch and asynchronous voice-list refresh.
- Existing full Node.js tests, dependency audit and Android Companion build remain required CI gates.
- Physical microphone, installed voice-pack, browser speech and notification-interrupt testing remains device-dependent and should be checked on the actual tablet.
