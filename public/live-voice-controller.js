const LIVE_SYSTEM_INSTRUCTION = [
  "You are JARVIS, a helpful personal voice assistant.",
  "Speak naturally and concisely. Match the user's language; Hindi, Hinglish and English are all acceptable.",
  "Use clear, age-appropriate language. Explain uncertainty instead of inventing facts.",
  "This is conversation-only mode. You cannot open apps, control devices, send messages, access files, or perform external actions.",
  "Never claim that you completed an action outside this voice conversation.",
  "Do not ask for passwords, PINs, OTPs, API keys, payment details, or other secrets.",
  "Do not automatically save personal details from this conversation as long-term memory.",
  "For current information, clearly say when you cannot verify it live. For important health, legal, financial, or safety topics, encourage checking a trusted source or qualified person."
].join("\n");

const LIVE_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export const LIVE_OUTPUT_SAMPLE_RATE = 24000;
export const LIVE_INPUT_SAMPLE_RATE = 16000;
export const LIVE_SESSION_MAX_MS = 10 * 60 * 1000;

export function buildLiveVoiceSetup(model) {
  if (typeof model !== "string" || !/^[a-zA-Z0-9._-]{3,100}$/.test(model.trim())) {
    throw new TypeError("Gemini Live model identifier is invalid.");
  }
  return {
    model: "models/" + model.trim(),
    generationConfig: {
      responseModalities: ["AUDIO"],
      temperature: 0.35,
      candidateCount: 1
    },
    systemInstruction: {
      parts: [{ text: LIVE_SYSTEM_INSTRUCTION }]
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {}
  };
}

export function encodePcm16Base64(input) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : null;
  if (!bytes || bytes.byteLength % 2 !== 0) {
    throw new TypeError("PCM audio must be an even-length ArrayBuffer or typed array.");
  }

  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new Error("Base64 encoding is unavailable in this browser.");
}

export function decodePcm16Base64(value) {
  if (typeof value !== "string" || !value) {
    throw new TypeError("PCM audio payload must be a non-empty base64 string.");
  }
  let bytes;
  if (typeof atob === "function") {
    const binary = atob(value);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } else if (typeof Buffer !== "undefined") {
    bytes = new Uint8Array(Buffer.from(value, "base64"));
  } else {
    throw new Error("Base64 decoding is unavailable in this browser.");
  }
  if (bytes.byteLength % 2 !== 0) throw new TypeError("PCM audio payload is malformed.");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Int16Array(bytes.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * 2, true);
  }
  return samples;
}

function stopTracks(stream) {
  if (!stream || typeof stream.getTracks !== "function") return;
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* Ignore already-ended tracks. */ }
  }
}

function appendListener(target, name, callback) {
  if (typeof target.addEventListener === "function") target.addEventListener(name, callback);
  else target["on" + name] = callback;
}

function errorCode(error) {
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") return "microphone-denied";
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "microphone-missing";
  if (error?.name === "NotReadableError") return "microphone-busy";
  if (error?.code === "LIVE_VOICE_NOT_CONFIGURED" || /live voice is disabled or not configured/i.test(String(error?.message || ""))) return "not-configured";
  if (/start limit reached/i.test(String(error?.message || ""))) return "rate-limited";
  return "connection-failed";
}

export function createLiveVoiceController(options = {}) {
  const WebSocketCtor = options.WebSocketCtor ?? globalThis.WebSocket;
  const AudioContextCtor = options.AudioContextCtor ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const AudioWorkletNodeCtor = options.AudioWorkletNodeCtor ?? globalThis.AudioWorkletNode;
  const mediaDevices = options.mediaDevices ?? globalThis.navigator?.mediaDevices;
  const fetchToken = options.fetchToken;
  const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
  const onTranscript = typeof options.onTranscript === "function" ? options.onTranscript : () => {};
  const onError = typeof options.onError === "function" ? options.onError : () => {};
  const setTimer = options.setTimeout ?? globalThis.setTimeout;
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout;

  let state = "idle";
  let generation = 0;
  let socket = null;
  let stream = null;
  let audioContext = null;
  let streamSource = null;
  let workletNode = null;
  let mutedGain = null;
  let ready = false;
  let playbackSources = new Set();
  let nextPlaybackTime = 0;
  let sessionTimer = null;
  let setupTimer = null;

  function setState(nextState) {
    state = nextState;
    onStateChange(nextState);
  }

  function safeSend(message) {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  function stopPlayback() {
    for (const source of playbackSources) {
      try {
        source.onended = null;
        source.stop();
        source.disconnect();
      } catch { /* Source may already have ended. */ }
    }
    playbackSources.clear();
    nextPlaybackTime = audioContext?.currentTime || 0;
  }

  function cleanup() {
    generation += 1;
    ready = false;
    if (sessionTimer !== null) clearTimer(sessionTimer);
    if (setupTimer !== null) clearTimer(setupTimer);
    sessionTimer = null;
    setupTimer = null;

    if (socket && socket.readyState === 1) {
      safeSend({ realtimeInput: { audioStreamEnd: true } });
    }
    const activeSocket = socket;
    socket = null;
    if (activeSocket && activeSocket.readyState < 2) {
      try { activeSocket.close(1000, "JARVIS session ended"); } catch { /* Ignore close failures. */ }
    }

    stopPlayback();
    if (workletNode) {
      try {
        workletNode.port.onmessage = null;
        workletNode.disconnect();
      } catch { /* Ignore already-disconnected nodes. */ }
    }
    if (streamSource) {
      try { streamSource.disconnect(); } catch { /* Ignore cleanup failures. */ }
    }
    if (mutedGain) {
      try { mutedGain.disconnect(); } catch { /* Ignore cleanup failures. */ }
    }
    stopTracks(stream);
    stream = null;
    workletNode = null;
    streamSource = null;
    mutedGain = null;

    const context = audioContext;
    audioContext = null;
    if (context && context.state !== "closed") {
      try { void context.close(); } catch { /* Ignore audio context cleanup failures. */ }
    }
  }

  function stop() {
    const wasActive = state !== "idle" || Boolean(socket) || Boolean(stream) || Boolean(audioContext);
    cleanup();
    setState("idle");
    return wasActive;
  }

  function fail(token, code) {
    if (token !== generation) return;
    cleanup();
    setState("idle");
    onError(code);
  }

  function queuePlayback(base64Audio, token) {
    if (token !== generation || !audioContext) return;
    let samples;
    try {
      samples = decodePcm16Base64(base64Audio);
    } catch {
      onError("invalid-audio");
      return;
    }
    if (!samples.length) return;

    const context = audioContext;
    const audioBuffer = context.createBuffer(1, samples.length, LIVE_OUTPUT_SAMPLE_RATE);
    const channel = audioBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      channel[index] = samples[index] / 32768;
    }

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.015, nextPlaybackTime);
    nextPlaybackTime = startAt + audioBuffer.duration;
    playbackSources.add(source);
    source.onended = () => {
      playbackSources.delete(source);
      try { source.disconnect(); } catch { /* Ignore already-ended source. */ }
      if (token === generation && ready && playbackSources.size === 0) setState("listening");
    };
    try {
      setState("speaking");
      source.start(startAt);
    } catch {
      playbackSources.delete(source);
      try { source.disconnect(); } catch { /* Ignore cleanup failures. */ }
      onError("audio-playback-failed");
    }
  }

  async function handleSocketMessage(event, token) {
    if (token !== generation) return;
    let raw = event?.data;
    if (typeof raw !== "string" && raw && typeof raw.text === "function") {
      try { raw = await raw.text(); } catch { return; }
    }
    if (typeof raw !== "string") return;

    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (token !== generation) return;

    if (message.setupComplete !== undefined) {
      ready = true;
      if (setupTimer !== null) clearTimer(setupTimer);
      setupTimer = null;
      setState("listening");
      sessionTimer = setTimer(() => {
        if (token !== generation) return;
        stop();
        onError("session-time-limit");
      }, LIVE_SESSION_MAX_MS);
      return;
    }

    const serverContent = message.serverContent;
    if (serverContent) {
      if (serverContent.interimInputTranscription?.text) {
        onTranscript({ role: "user", text: serverContent.interimInputTranscription.text, interim: true });
      }
      if (serverContent.inputTranscription?.text) {
        onTranscript({ role: "user", text: serverContent.inputTranscription.text, interim: false });
      }
      if (serverContent.outputTranscription?.text) {
        onTranscript({ role: "assistant", text: serverContent.outputTranscription.text, interim: false });
      }
      const wasInterrupted = Boolean(serverContent.interrupted);
      if (wasInterrupted) {
        stopPlayback();
        setState("listening");
      }
      const parts = Array.isArray(serverContent.modelTurn?.parts) ? serverContent.modelTurn.parts : [];
      if (!wasInterrupted) {
        for (const part of parts) {
          const audio = part?.inlineData?.data || part?.inline_data?.data;
          if (typeof audio === "string") queuePlayback(audio, token);
        }
      }
      if (serverContent.turnComplete && playbackSources.size === 0 && ready) {
        setState("listening");
      }
    }

    if (message.goAway) {
      fail(token, "session-expiring");
    } else if (message.error) {
      fail(token, "provider-error");
    } else if (message.toolCall) {
      // No tools are configured for this voice-only session. Never execute provider requests.
      fail(token, "unexpected-tool-request");
    }
  }

  async function start() {
    stop();
    const token = ++generation;
    setState("connecting");

    if (typeof WebSocketCtor !== "function" ||
        typeof AudioContextCtor !== "function" ||
        typeof AudioWorkletNodeCtor !== "function" ||
        typeof mediaDevices?.getUserMedia !== "function" ||
        typeof fetchToken !== "function") {
      setState("idle");
      onError("unsupported");
      return false;
    }

    try {
      // Start browser audio and microphone permission requests directly from the user's tap.
      audioContext = new AudioContextCtor({ latencyHint: "interactive" });
      const resumePromise = audioContext.resume();
      const tokenPromise = fetchToken();
      const microphonePromise = mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }).then((acquiredStream) => {
        if (token !== generation) {
          stopTracks(acquiredStream);
          return null;
        }
        return acquiredStream;
      });

      const [, credentials, acquiredStream] = await Promise.all([
        resumePromise,
        tokenPromise,
        microphonePromise
      ]);
      if (token !== generation) {
        stopTracks(acquiredStream);
        return false;
      }
      if (!acquiredStream) return false;
      if (!credentials || typeof credentials.token !== "string" || !credentials.token ||
          typeof credentials.model !== "string" || !credentials.model) {
        stopTracks(acquiredStream);
        throw new Error("Live voice token response was invalid.");
      }
      stream = acquiredStream;

      await audioContext.audioWorklet.addModule("/voice-capture-worklet.js");
      if (token !== generation) return false;

      streamSource = audioContext.createMediaStreamSource(stream);
      workletNode = new AudioWorkletNodeCtor(audioContext, "jarvis-pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1]
      });
      mutedGain = audioContext.createGain();
      mutedGain.gain.value = 0;
      streamSource.connect(workletNode);
      workletNode.connect(mutedGain);
      mutedGain.connect(audioContext.destination);

      const url = LIVE_ENDPOINT + "?access_token=" + encodeURIComponent(credentials.token);
      socket = new WebSocketCtor(url);

      workletNode.port.onmessage = (event) => {
        if (token !== generation || !ready || !socket || socket.readyState !== 1) return;
        try {
          const pcm = encodePcm16Base64(event.data);
          safeSend({
            realtimeInput: {
              audio: { data: pcm, mimeType: "audio/pcm;rate=16000" }
            }
          });
        } catch {
          onError("audio-capture-failed");
        }
      };

      appendListener(socket, "open", () => {
        if (token !== generation || !socket || socket.readyState !== 1) return;
        try {
          socket.send(JSON.stringify({ setup: buildLiveVoiceSetup(credentials.model) }));
          setupTimer = setTimer(() => fail(token, "setup-timeout"), 15000);
        } catch {
          fail(token, "connection-failed");
        }
      });
      appendListener(socket, "message", (event) => {
        void handleSocketMessage(event, token);
      });
      appendListener(socket, "error", () => fail(token, "connection-failed"));
      appendListener(socket, "close", () => {
        if (token === generation && state !== "idle") fail(token, "connection-closed");
      });
      return true;
    } catch (error) {
      if (token === generation) {
        cleanup();
        setState("idle");
        onError(errorCode(error));
      }
      return false;
    }
  }

  return {
    getState: () => state,
    start,
    stop
  };
}
