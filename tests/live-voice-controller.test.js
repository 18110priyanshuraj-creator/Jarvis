import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiveVoiceSetup as buildServerLiveVoiceSetup } from "../services/live-voice.js";
import {
  buildLiveVoiceSetup,
  decodePcm16Base64,
  encodePcm16Base64,
  LIVE_INPUT_SAMPLE_RATE,
  LIVE_OUTPUT_SAMPLE_RATE,
  LIVE_SESSION_MAX_MS
} from "../public/live-voice-controller.js";

test("browser Live setup is locked to the expected model and bidirectional audio config", () => {
  const setup = buildLiveVoiceSetup("gemini-3.8-live");
  assert.equal(setup.model, "models/gemini-3.8-live");
  assert.deepEqual(setup.generationConfig.responseModalities, ["AUDIO"]);
  assert.deepEqual(setup.inputAudioTranscription, {});
  assert.deepEqual(setup.outputAudioTranscription, {});
  assert.match(setup.systemInstruction.parts[0].text, /conversation-only mode/i);
  assert.throws(() => buildLiveVoiceSetup("not a model"), TypeError);
});

test("PCM input and output sample rates match Gemini Live wire requirements", () => {
  assert.equal(LIVE_INPUT_SAMPLE_RATE, 16000);
  assert.equal(LIVE_OUTPUT_SAMPLE_RATE, 24000);
  assert.equal(LIVE_SESSION_MAX_MS, 10 * 60 * 1000);
});

test("PCM16 encoder and decoder preserve signed little-endian samples", () => {
  const original = Int16Array.from([-32768, -1, 0, 1, 32767]);
  const encoded = encodePcm16Base64(original);
  const decoded = decodePcm16Base64(encoded);
  assert.deepEqual(Array.from(decoded), Array.from(original));
});

test("PCM encoder rejects odd byte lengths and unsupported input types", () => {
  assert.throws(() => encodePcm16Base64(new Uint8Array([1, 2, 3])), TypeError);
  assert.throws(() => encodePcm16Base64("not audio"), TypeError);
});

test("PCM decoder rejects missing and malformed payloads", () => {
  assert.throws(() => decodePcm16Base64(""), TypeError);
  const oddLength = typeof btoa === "function" ? btoa("\u0001") : Buffer.from([1]).toString("base64");
  assert.throws(() => decodePcm16Base64(oddLength), TypeError);
});

test("browser WebSocket setup matches the server-constrained ephemeral token setup", () => {
  assert.deepEqual(
    buildLiveVoiceSetup("gemini-3.8-live"),
    buildServerLiveVoiceSetup("gemini-3.8-live")
  );
});
