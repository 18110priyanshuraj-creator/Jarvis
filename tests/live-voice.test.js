import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveVoiceConfig,
  createLiveVoiceToken,
  getLiveVoiceConfiguration,
  LIVE_SESSION_MAX_MS,
  LIVE_TOKEN_START_WINDOW_MS,
  LIVE_TOKEN_TTL_MS
} from "../services/live-voice.js";

test("Live voice stays disabled unless explicitly opted in with a valid key and model", () => {
  assert.equal(getLiveVoiceConfiguration({ GEMINI_API_KEY: "key" }).enabled, false);
  assert.equal(getLiveVoiceConfiguration({
    GEMINI_API_KEY: "",
    GEMINI_LIVE_VOICE_ENABLED: "true"
  }).enabled, false);
  assert.equal(getLiveVoiceConfiguration({
    GEMINI_API_KEY: "key",
    GEMINI_LIVE_VOICE_ENABLED: "true",
    GEMINI_LIVE_MODEL: "invalid model"
  }).enabled, false);
  const enabled = getLiveVoiceConfiguration({
    GEMINI_API_KEY: "key",
    GEMINI_LIVE_VOICE_ENABLED: "true",
    GEMINI_LIVE_MODEL: "gemini-3.8-live"
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.model, "gemini-3.8-live");
  assert.equal(enabled.configured, true);
});

test("Live voice config enables audio in both directions and keeps conversation guardrails", () => {
  const config = buildLiveVoiceConfig();
  assert.deepEqual(config.responseModalities, ["AUDIO"]);
  assert.deepEqual(config.inputAudioTranscription, {});
  assert.deepEqual(config.outputAudioTranscription, {});
  const instruction = config.systemInstruction.parts[0].text;
  assert.match(instruction, /conversation-only mode/i);
  assert.match(instruction, /cannot open apps/i);
  assert.match(instruction, /Do not ask for passwords/i);
});

test("token creation uses one use, bounded expiry, and server-specified live configuration", async () => {
  const now = Date.parse("2026-11-01T12:00:00.000Z");
  let received;
  const result = await createLiveVoiceToken({
    apiKey: "server-secret",
    model: "gemini-3.8-live",
    now,
    createClient: (apiKey) => {
      assert.equal(apiKey, "server-secret");
      return {
        authTokens: {
          create: async (args) => {
            received = args;
            return { name: "ephemeral-test-token" };
          }
        }
      };
    }
  });

  assert.equal(received.config.uses, 1);
  assert.equal(received.config.expireTime, new Date(now + LIVE_TOKEN_TTL_MS).toISOString());
  assert.equal(received.config.newSessionExpireTime, new Date(now + LIVE_TOKEN_START_WINDOW_MS).toISOString());
  assert.equal(received.config.liveConnectConstraints.model, "gemini-3.8-live");
  assert.deepEqual(received.config.liveConnectConstraints.config.responseModalities, ["AUDIO"]);
  assert.equal(result.token, "ephemeral-test-token");
  assert.equal(result.model, "gemini-3.8-live");
  assert.equal(result.expiresAt, received.config.expireTime);
  assert.equal(LIVE_SESSION_MAX_MS, 10 * 60 * 1000);
});

test("token creation rejects missing keys and invalid model identifiers before calling Google", async () => {
  let called = false;
  const createClient = () => {
    called = true;
    throw new Error("must not create client");
  };
  await assert.rejects(
    createLiveVoiceToken({ apiKey: "", model: "gemini-3.8-live", createClient }),
    { code: "LIVE_VOICE_NOT_CONFIGURED" }
  );
  await assert.rejects(
    createLiveVoiceToken({ apiKey: "key", model: "not a model", createClient }),
    { code: "LIVE_VOICE_INVALID_MODEL" }
  );
  assert.equal(called, false);
});

test("token creation rejects an empty provider token response", async () => {
  await assert.rejects(
    createLiveVoiceToken({
      apiKey: "key",
      model: "gemini-3.8-live",
      createClient: () => ({ authTokens: { create: async () => ({}) } })
    }),
    { code: "LIVE_VOICE_TOKEN_INVALID" }
  );
});
