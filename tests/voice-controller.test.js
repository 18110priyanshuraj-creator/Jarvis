import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceController } from "../public/voice-controller.js";

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
