# Phase 12 — Voice Interaction v1

## Goal

Make the existing browser voice controls reliable and interruptible without changing the chat backend or claiming always-on/full-duplex audio.

## Included in this milestone

- A separate, testable browser voice controller for one-shot speech recognition and browser speech synthesis.
- Hindi (India) and English (India) input-language selection.
- Visible voice state: ready, listening, speaking.
- The microphone button toggles listening; while a spoken reply is playing, it interrupts playback and starts listening.
- A dedicated Stop speaking button cancels current browser speech output.
- A new typed or spoken chat turn stops an older spoken reply before sending.
- Recognition and speech callbacks are generation-guarded so stale browser events cannot overwrite a newer voice state.
- Unsupported browsers, denied microphone permission, no-speech and network failures receive clear feedback.

## Privacy and activation

The microphone starts only after the user presses Speak/Interrupt. Recognition is one-shot (`continuous=false`), and the browser returns a transcript that is submitted through the existing chat form. The existing server chat privacy, login and rate-limit rules remain unchanged. There is no background microphone session or audio recording upload added by this phase.

## Current limitations

- Responses still come from the existing non-streaming chat API. JARVIS waits for the complete text reply before browser speech synthesis begins.
- Browser voice support and available voices vary by browser/device. The native Android Companion keeps its own Speak once and user-started hands-free controls.
- This is not full-duplex audio, wake-word detection, continuous listening, live audio streaming, or voice activity detection. Those require a separate backend/audio transport design.

## Verification

The voice controller has Node unit tests for recognition setup, transcript forwarding, error handling, speech start/end, cancellation, interruption, language selection and stale callback protection. CI must pass before this PR is merged. Physical browser and Android testing remains required.
