import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceController, splitSpeechText } from "../public/voice-controller.js";

class FakeRecognition {
  static instances = [];

  constructor() {
    this.stopCalls = 0;
    FakeRecognition.instances.push(this);
  }

  start() {
    this.onstart?.();
  }

  stop() {
    this.stopCalls += 1;
    this.onend?.();
  }
}

function makeSpeechHarness() {
  return {
    cancelCalls: 0,
    spoken: [],
    cancel() {
      this.cancelCalls += 1;
    },
    speak(utterance) {
      this.spoken.push(utterance);
    }
  };
}

function makeController(overrides = {}) {
  const states = [];
  const errors = [];
  const transcripts = [];
  const speechSynthesis = makeSpeechHarness();
  const controller = createVoiceController({
    SpeechRecognitionCtor: FakeRecognition,
    speechSynthesis,
    createUtterance: (text) => ({ text }),
    onStateChange: (state) => states.push(state),
    onTranscript: (transcript) => transcripts.push(transcript),
    onError: (error) => errors.push(error),
    ...overrides
  });
  return { controller, speechSynthesis, states, errors, transcripts };
}

test("starts one-shot recognition with the selected Hindi language", () => {
  FakeRecognition.instances = [];
  const { controller, states } = makeController();

  assert.equal(controller.getLanguage(), "hi-IN");
  assert.equal(controller.startListening(), true);

  const recognition = FakeRecognition.instances.at(-1);
  assert.equal(recognition.lang, "hi-IN");
  assert.equal(recognition.continuous, false);
  assert.equal(recognition.interimResults, false);
  assert.equal(recognition.maxAlternatives, 1);
  assert.equal(controller.getState(), "listening");
  assert.equal(states.at(-1), "listening");
});

test("forwards only a trimmed final transcript", () => {
  FakeRecognition.instances = [];
  const { controller, transcripts } = makeController();
  controller.startListening();

  FakeRecognition.instances.at(-1).onresult({
    resultIndex: 0,
    results: [[{ transcript: "  namaste JARVIS  " }]]
  });

  assert.deepEqual(transcripts, ["namaste JARVIS"]);
});

test("toggle stops an active listening session", () => {
  FakeRecognition.instances = [];
  const { controller } = makeController();
  controller.startListening();

  assert.equal(controller.toggleListening(), false);
  assert.equal(FakeRecognition.instances.at(-1).stopCalls, 1);
  assert.equal(controller.getState(), "idle");
});

test("maps recognition errors to idle and reports the browser error code", () => {
  FakeRecognition.instances = [];
  const { controller, errors } = makeController();
  controller.startListening();

  FakeRecognition.instances.at(-1).onerror({ error: "not-allowed" });

  assert.deepEqual(errors, ["not-allowed"]);
  assert.equal(controller.getState(), "idle");
});

test("speaks a reply with the requested language and returns to idle at the end", () => {
  const { controller, speechSynthesis, states } = makeController();

  assert.equal(controller.speak("नमस्ते", "hi-IN"), true);
  const utterance = speechSynthesis.spoken.at(-1);
  assert.equal(utterance.text, "नमस्ते");
  assert.equal(utterance.lang, "hi-IN");
  assert.equal(controller.getState(), "speaking");

  utterance.onstart();
  utterance.onend();
  assert.equal(controller.getState(), "idle");
  assert.deepEqual(states.slice(-2), ["speaking", "idle"]);
});

test("stop speaking cancels playback and ignores a late end event", () => {
  const { controller, speechSynthesis } = makeController();
  controller.speak("A spoken reply", "en-IN");
  const utterance = speechSynthesis.spoken.at(-1);

  assert.equal(controller.stopSpeaking(), true);
  assert.equal(speechSynthesis.cancelCalls, 1);
  assert.equal(controller.getState(), "idle");

  utterance.onend();
  assert.equal(controller.getState(), "idle");
});

test("starting the microphone interrupts current speech output", () => {
  FakeRecognition.instances = [];
  const { controller, speechSynthesis } = makeController();
  controller.speak("One moment", "en-IN");

  assert.equal(controller.startListening(), true);
  assert.equal(speechSynthesis.cancelCalls, 1);
  assert.equal(FakeRecognition.instances.at(-1).lang, "hi-IN");
  assert.equal(controller.getState(), "listening");
});

test("new speech replaces old speech and stale callbacks cannot reset its state", () => {
  const { controller, speechSynthesis } = makeController();
  controller.speak("First reply", "en-IN");
  const first = speechSynthesis.spoken[0];

  controller.speak("Second reply", "hi-IN");
  const second = speechSynthesis.spoken[1];

  first.onend();
  assert.equal(controller.getState(), "speaking");
  assert.equal(second.text, "Second reply");
  assert.equal(second.lang, "hi-IN");
});

test("voice language accepts only Hindi and English India", () => {
  const { controller } = makeController();

  assert.equal(controller.setLanguage("en-IN"), "en-IN");
  assert.equal(controller.getLanguage(), "en-IN");
  assert.equal(controller.setLanguage("fr-FR"), "hi-IN");
  assert.equal(controller.getLanguage(), "hi-IN");
});

test("unsupported recognition and playback report clear error codes", () => {
  const errors = [];
  const controller = createVoiceController({
    SpeechRecognitionCtor: null,
    speechSynthesis: null,
    createUtterance: null,
    onError: (error) => errors.push(error)
  });

  assert.equal(controller.startListening(), false);
  assert.equal(controller.speak("Hello"), false);
  assert.deepEqual(errors, ["unsupported", "speech-unavailable"]);
});


test("splits long spoken replies into readable chunks without losing words", () => {
  const text = "This is the first sentence. This is the second sentence. " +
    "यह तीसरा वाक्य है। This is the fourth sentence with a longer explanation.";
  const chunks = splitSpeechText(text, 90);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.join(" "), text.replace(/\\s+/g, " "));
  assert.ok(chunks.every(chunk => chunk.length <= 90));
});

test("uses a language-matched local voice and applies speech rate and pitch", () => {
  const voices = [
    { voiceURI: "en-local", name: "English Local", lang: "en-IN", localService: true, default: false },
    { voiceURI: "hi-network", name: "Hindi Network", lang: "hi-IN", localService: false, default: true },
    { voiceURI: "hi-local", name: "Hindi Local", lang: "hi-IN", localService: true, default: false }
  ];
  const speechSynthesis = {
    ...makeSpeechHarness(),
    getVoices: () => voices,
    addEventListener() {},
    removeEventListener() {}
  };
  const controller = createVoiceController({
    SpeechRecognitionCtor: FakeRecognition,
    speechSynthesis,
    createUtterance: text => ({ text }),
    rate: 1.1,
    pitch: 0.95,
    maxChunkChars: 220
  });

  assert.equal(controller.getVoiceOptions("hi-IN")[0].voiceURI, "hi-local");
  assert.equal(controller.speak("नमस्ते, JARVIS यहाँ है।", "hi-IN"), true);
  const utterance = speechSynthesis.spoken[0];
  assert.equal(utterance.voice.voiceURI, "hi-local");
  assert.equal(utterance.lang, "hi-IN");
  assert.equal(utterance.rate, 1.1);
  assert.equal(utterance.pitch, 0.95);
});

test("plays a long reply sequentially and returns to idle only after the last chunk", () => {
  const speechSynthesis = makeSpeechHarness();
  const controller = createVoiceController({
    speechSynthesis,
    SpeechRecognitionCtor: FakeRecognition,
    createUtterance: text => ({ text }),
    maxChunkChars: 80
  });
  const text = "First sentence. ".repeat(8);

  assert.equal(controller.speak(text, "en-IN"), true);
  assert.equal(speechSynthesis.spoken.length, 1);
  assert.equal(controller.getState(), "speaking");

  let chunksPlayed = 1;
  while (speechSynthesis.spoken[chunksPlayed - 1]?.onend && chunksPlayed < 10) {
    speechSynthesis.spoken[chunksPlayed - 1].onend();
    chunksPlayed = speechSynthesis.spoken.length;
  }

  assert.ok(speechSynthesis.spoken.length > 1);
  assert.equal(controller.getState(), "idle");
  assert.equal(speechSynthesis.spoken.map(item => item.text).join(" "), text.trim());
});

test("stopping chunked speech prevents queued chunks and ignores late callbacks", () => {
  const speechSynthesis = makeSpeechHarness();
  const controller = createVoiceController({
    speechSynthesis,
    SpeechRecognitionCtor: FakeRecognition,
    createUtterance: text => ({ text }),
    maxChunkChars: 80
  });
  controller.speak("A long response that must be interrupted. ".repeat(8), "en-IN");
  const first = speechSynthesis.spoken[0];

  assert.equal(controller.stopSpeaking(), true);
  first.onend();
  assert.equal(speechSynthesis.cancelCalls, 1);
  assert.equal(speechSynthesis.spoken.length, 1);
  assert.equal(controller.getState(), "idle");
});

test("voice selection ignores a selected voice that does not match the answer language", () => {
  const voices = [
    { voiceURI: "en-local", name: "English", lang: "en-IN", localService: true },
    { voiceURI: "hi-local", name: "Hindi", lang: "hi-IN", localService: true }
  ];
  const speechSynthesis = {
    ...makeSpeechHarness(),
    getVoices: () => voices,
    addEventListener() {},
    removeEventListener() {}
  };
  const controller = createVoiceController({
    speechSynthesis,
    SpeechRecognitionCtor: FakeRecognition,
    createUtterance: text => ({ text })
  });
  assert.equal(controller.setVoiceURI("en-local"), true);
  controller.speak("नमस्ते", "hi-IN");
  assert.equal(speechSynthesis.spoken[0].voice.voiceURI, "hi-local");
});

test("voiceschanged refreshes the available voice list and destroy removes its listener", () => {
  const listeners = {};
  const voices = [{ voiceURI: "hi-local", name: "Hindi Local", lang: "hi-IN", localService: true }];
  const updates = [];
  const speechSynthesis = {
    ...makeSpeechHarness(),
    getVoices: () => voices,
    addEventListener: (name, handler) => { listeners[name] = handler; },
    removeEventListener: (name, handler) => {
      if (listeners[name] === handler) delete listeners[name];
    }
  };
  const controller = createVoiceController({
    speechSynthesis,
    SpeechRecognitionCtor: FakeRecognition,
    createUtterance: text => ({ text }),
    onVoicesChanged: items => updates.push(items)
  });
  listeners.voiceschanged();
  assert.equal(updates.at(-1)[0].voiceURI, "hi-local");
  controller.destroy();
  assert.equal(listeners.voiceschanged, undefined);
});
