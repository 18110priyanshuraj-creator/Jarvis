const SUPPORTED_LANGUAGES = new Set(["hi-IN", "en-IN"]);

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

  let recognition = null;
  let utterance = null;
  let state = "idle";
  let language = "hi-IN";
  let generation = 0;

  function setState(nextState) {
    state = nextState;
    onStateChange(nextState);
  }

  function setLanguage(nextLanguage) {
    language = SUPPORTED_LANGUAGES.has(nextLanguage) ? nextLanguage : "hi-IN";
    return language;
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
    if (!utterance) return false;
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
    if (!speech || typeof speech.speak !== "function" || typeof createUtterance !== "function") {
      onError("speech-unavailable");
      return false;
    }

    stopListening();
    stopSpeaking();

    let current;
    try {
      current = createUtterance(cleanText);
    } catch {
      onError("speech-failed");
      return false;
    }

    const token = ++generation;
    utterance = current;
    current.lang = SUPPORTED_LANGUAGES.has(requestedLanguage)
      ? requestedLanguage
      : language;

    const isCurrent = () => utterance === current && generation === token;

    current.onstart = () => {
      if (isCurrent()) setState("speaking");
    };

    current.onend = () => {
      if (!isCurrent()) return;
      utterance = null;
      setState("idle");
    };

    current.onerror = (event) => {
      if (!isCurrent()) return;
      utterance = null;
      setState("idle");
      onError(typeof event?.error === "string" ? event.error : "speech-failed");
    };

    try {
      setState("speaking");
      speech.speak(current);
      return true;
    } catch {
      if (isCurrent()) {
        utterance = null;
        setState("idle");
      }
      onError("speech-failed");
      return false;
    }
  }

  function stop() {
    const stoppedListening = stopListening();
    const stoppedSpeaking = stopSpeaking();
    if (!stoppedListening && !stoppedSpeaking && state !== "idle") setState("idle");
    return stoppedListening || stoppedSpeaking;
  }

  return {
    getLanguage: () => language,
    getState: () => state,
    setLanguage,
    startListening,
    stop,
    stopListening,
    stopSpeaking,
    speak,
    toggleListening
  };
}
