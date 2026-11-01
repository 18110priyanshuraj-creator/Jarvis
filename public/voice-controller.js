const SUPPORTED_LANGUAGES = new Set(["hi-IN", "en-IN"]);

function normalizeLanguage(value, fallback = "hi-IN") {
  const raw = typeof value === "string" ? value.trim() : "";
  return SUPPORTED_LANGUAGES.has(raw) ? raw : fallback;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function splitSpeechText(input, maxChars = 220) {
  const text = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  const limit = Math.max(80, Math.min(1200, Math.trunc(maxChars) || 220));
  if (!text) return [];
  const chunks = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const sentenceBreak = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf("। "),
      window.lastIndexOf("。 ")
    );
    const wordBreak = window.lastIndexOf(" ");
    const boundary = sentenceBreak >= Math.floor(limit * 0.45)
      ? sentenceBreak + 1
      : wordBreak > 0 ? wordBreak : limit;

    const chunk = remaining.slice(0, boundary).trim();
    if (!chunk) {
      chunks.push(remaining.slice(0, limit).trim());
      remaining = remaining.slice(limit).trim();
      continue;
    }
    chunks.push(chunk);
    remaining = remaining.slice(boundary).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function createVoiceController(options = {}) {
  const Recognition = options.SpeechRecognitionCtor
    ?? globalThis.SpeechRecognition
    ?? globalThis.webkitSpeechRecognition;
  const speech = options.speechSynthesis ?? globalThis.speechSynthesis;
  const createUtterance = options.createUtterance
    ?? ((text) => new globalThis.SpeechSynthesisUtterance(text));
  const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
  const onTranscript = typeof options.onTranscript === "function" ? options.onTranscript : () => {};
  const onError = typeof options.onError === "function" ? options.onError : () => {};
  const onVoicesChanged = typeof options.onVoicesChanged === "function" ? options.onVoicesChanged : () => {};
  const maxChunkChars = boundedNumber(options.maxChunkChars, 220, 80, 1200);

  let recognition = null;
  let utterance = null;
  let state = "idle";
  let language = "hi-IN";
  let generation = 0;
  let selectedVoiceURI = "";
  let speechRate = boundedNumber(options.rate, 1, 0.75, 1.25);
  let speechPitch = boundedNumber(options.pitch, 1, 0.8, 1.2);
  let speechVolume = boundedNumber(options.volume, 1, 0, 1);
  let destroyed = false;

  function setState(nextState) {
    state = nextState;
    onStateChange(nextState);
  }

  function setLanguage(nextLanguage) {
    language = normalizeLanguage(nextLanguage);
    return language;
  }

  function getVoices() {
    try {
      const voices = speech?.getVoices?.();
      return Array.isArray(voices) ? voices : [];
    } catch {
      return [];
    }
  }

  function getVoiceOptions(requestedLanguage = language) {
    const requested = normalizeLanguage(requestedLanguage);
    const prefix = requested.split("-")[0].toLowerCase();
    return getVoices()
      .filter(voice => voice && typeof voice.voiceURI === "string" && voice.voiceURI)
      .filter(voice => {
        const locale = String(voice.lang || "").toLowerCase();
        return locale === requested.toLowerCase() || locale.split("-")[0] === prefix;
      })
      .map(voice => ({
        voiceURI: voice.voiceURI,
        name: String(voice.name || voice.voiceURI),
        lang: String(voice.lang || ""),
        localService: voice.localService === true,
        default: voice.default === true
      }))
      .sort((left, right) =>
        Number(right.lang.toLowerCase() === requested.toLowerCase()) -
          Number(left.lang.toLowerCase() === requested.toLowerCase()) ||
        Number(right.localService) - Number(left.localService) ||
        Number(right.default) - Number(left.default) ||
        left.name.localeCompare(right.name)
      );
  }

  function setVoiceURI(voiceURI) {
    const candidate = typeof voiceURI === "string" ? voiceURI.trim() : "";
    if (!candidate || candidate === "auto") {
      selectedVoiceURI = "";
      return true;
    }
    const exists = getVoices().some(voice => voice?.voiceURI === candidate);
    if (!exists) return false;
    selectedVoiceURI = candidate;
    return true;
  }

  function setSpeechRate(value) {
    speechRate = boundedNumber(value, 1, 0.75, 1.25);
    return speechRate;
  }

  function setSpeechPitch(value) {
    speechPitch = boundedNumber(value, 1, 0.8, 1.2);
    return speechPitch;
  }

  function resolveVoice(requestedLanguage) {
    const voices = getVoiceOptions(requestedLanguage);
    if (selectedVoiceURI) {
      const selected = voices.find(voice => voice.voiceURI === selectedVoiceURI);
      if (selected) return selected;
    }
    return voices[0] || null;
  }

  function stopListening() {
    if (!recognition) return false;
    const current = recognition;
    recognition = null;
    generation += 1;
    try {
      current.stop();
    } catch {
      // The browser may already have ended recognition.
    }
    if (state === "listening") setState("idle");
    return true;
  }

  function stopSpeaking() {
    if (!utterance && state !== "speaking") return false;
    utterance = null;
    generation += 1;
    try {
      speech?.cancel?.();
    } catch {
      onError("speech-stop-failed");
    }
    if (state === "speaking") setState("idle");
    return true;
  }

  function startListening() {
    if (destroyed) return false;
    if (typeof Recognition !== "function") {
      onError("unsupported");
      return false;
    }

    stopSpeaking();
    if (recognition) stopListening();

    let current;
    try {
      current = new Recognition();
    } catch {
      onError("recognition-start-failed");
      return false;
    }

    const token = ++generation;
    recognition = current;
    current.lang = language;
    current.continuous = false;
    current.interimResults = false;
    current.maxAlternatives = 1;

    const isCurrent = () => recognition === current && generation === token;

    current.onstart = () => {
      if (isCurrent()) setState("listening");
    };

    current.onresult = (event) => {
      if (!isCurrent()) return;
      const results = event?.results;
      if (!results || results.length === 0) {
        onError("no-speech");
        return;
      }
      const index = Number.isInteger(event.resultIndex)
        ? event.resultIndex
        : results.length - 1;
      const transcript = String(results[index]?.[0]?.transcript || "").trim();
      if (transcript) onTranscript(transcript);
      else onError("no-speech");
    };

    current.onerror = (event) => {
      if (!isCurrent()) return;
      recognition = null;
      generation += 1;
      setState("idle");
      onError(typeof event?.error === "string" ? event.error : "recognition-error");
    };

    current.onend = () => {
      if (!isCurrent()) return;
      recognition = null;
      setState("idle");
    };

    try {
      current.start();
      return true;
    } catch {
      if (isCurrent()) {
        recognition = null;
        generation += 1;
        setState("idle");
      }
      onError("recognition-start-failed");
      return false;
    }
  }

  function toggleListening() {
    if (recognition) {
      stopListening();
      return false;
    }
    return startListening();
  }

  function speak(text, requestedLanguage = language) {
    const cleanText = typeof text === "string" ? text.trim() : "";
    if (!cleanText) return false;
    if (destroyed) return false;
    if (!speech || typeof speech.speak !== "function" || typeof createUtterance !== "function") {
      onError("speech-unavailable");
      return false;
    }

    stopListening();
    stopSpeaking();

    const targetLanguage = normalizeLanguage(requestedLanguage, language);
    const chunks = splitSpeechText(cleanText, maxChunkChars);
    if (!chunks.length) return false;

    const token = ++generation;
    let chunkIndex = 0;

    const isCurrent = () => generation === token && !destroyed;

    const speakNext = () => {
      if (!isCurrent()) return;
      const chunk = chunks[chunkIndex];
      if (!chunk) {
        utterance = null;
        setState("idle");
        return;
      }
      chunkIndex += 1;

      let current;
      try {
        current = createUtterance(chunk);
      } catch {
        utterance = null;
        generation += 1;
        setState("idle");
        onError("speech-failed");
        return;
      }

      utterance = current;
      current.lang = targetLanguage;
      current.rate = speechRate;
      current.pitch = speechPitch;
      current.volume = speechVolume;
      const selectedVoice = resolveVoice(targetLanguage);
      if (selectedVoice) {
        const voiceObject = getVoices().find(voice => voice?.voiceURI === selectedVoice.voiceURI);
        if (voiceObject) current.voice = voiceObject;
      }

      current.onstart = () => {
        if (isCurrent() && utterance === current && state !== "speaking") setState("speaking");
      };

      current.onend = () => {
        if (!isCurrent() || utterance !== current) return;
        if (chunkIndex < chunks.length) {
          speakNext();
        } else {
          utterance = null;
          setState("idle");
        }
      };

      current.onerror = (event) => {
        if (!isCurrent() || utterance !== current) return;
        utterance = null;
        generation += 1;
        setState("idle");
        onError(typeof event?.error === "string" ? event.error : "speech-failed");
      };

      try {
        setState("speaking");
        speech.speak(current);
      } catch {
        if (isCurrent()) {
          utterance = null;
          generation += 1;
          setState("idle");
        }
        onError("speech-failed");
      }
    };

    speakNext();
    return true;
  }

  function stop() {
    const stoppedListening = stopListening();
    const stoppedSpeaking = stopSpeaking();
    if (!stoppedListening && !stoppedSpeaking && state !== "idle") setState("idle");
    return stoppedListening || stoppedSpeaking;
  }

  const handleVoicesChanged = () => {
    if (!destroyed) onVoicesChanged(getVoiceOptions(language));
  };

  try {
    speech?.addEventListener?.("voiceschanged", handleVoicesChanged);
  } catch {
    // Some speech engines expose voiceschanged only after the first request.
  }

  return {
    getLanguage: () => language,
    getState: () => state,
    getVoiceOptions,
    getSelectedVoiceURI: () => selectedVoiceURI,
    getSpeechRate: () => speechRate,
    getSpeechPitch: () => speechPitch,
    setLanguage,
    setVoiceURI,
    setSpeechRate,
    setSpeechPitch,
    startListening,
    stop,
    stopListening,
    stopSpeaking,
    speak,
    toggleListening,
    refreshVoices: handleVoicesChanged,
    destroy() {
      stop();
      destroyed = true;
      try {
        speech?.removeEventListener?.("voiceschanged", handleVoicesChanged);
      } catch {
        // The browser may already have released the speech engine.
      }
    }
  };
}
