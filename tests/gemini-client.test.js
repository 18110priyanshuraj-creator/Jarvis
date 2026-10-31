import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getGeminiClient,
  getGeminiModel,
  getGeminiRuntimeStatus
} from "../services/gemini-client.js";

const ENV_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_CHAT_ENABLED",
  "GEMINI_WEB_RESEARCH_ENABLED",
  "GEMINI_REQUEST_TIMEOUT_MS",
  "GEMINI_RETRY_ATTEMPTS"
];

function withEnv(values, callback) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return callback();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("Gemini stays unavailable when the server key is missing or whitespace", () => {
  withEnv({
    GEMINI_API_KEY: "   ",
    GEMINI_CHAT_ENABLED: "true",
    GEMINI_WEB_RESEARCH_ENABLED: "true"
  }, () => {
    const status = getGeminiRuntimeStatus();
    assert.equal(status.configured, false);
    assert.equal(status.plannerEnabled, false);
    assert.equal(status.conversationEnabled, false);
    assert.equal(status.webResearchEnabled, false);
    assert.equal(getGeminiClient(), null);
  });
});

test("Gemini readiness exposes safe configuration metadata without returning secrets", () => {
  withEnv({
    GEMINI_API_KEY: "test-secret-that-must-not-leak",
    GEMINI_CHAT_ENABLED: "true",
    GEMINI_WEB_RESEARCH_ENABLED: "true"
  }, () => {
    const status = getGeminiRuntimeStatus();
    assert.equal(status.provider, "gemini");
    assert.equal(status.configured, true);
    assert.equal(status.model, "gemini-3.8-flash");
    assert.equal(status.modelValid, true);
    assert.equal(status.plannerEnabled, true);
    assert.equal(status.conversationEnabled, true);
    assert.equal(status.webResearchEnabled, true);
    assert.equal(JSON.stringify(status).includes("test-secret-that-must-not-leak"), false);
    assert.equal(Object.hasOwn(status, "apiKey"), false);
  });
});

test("Gemini timeout and retry settings are bounded", () => {
  withEnv({
    GEMINI_API_KEY: "test-key",
    GEMINI_REQUEST_TIMEOUT_MS: "999999",
    GEMINI_RETRY_ATTEMPTS: "99"
  }, () => {
    const status = getGeminiRuntimeStatus();
    assert.equal(status.requestTimeoutMs, 60000);
    assert.equal(status.retryAttempts, 3);
  });

  withEnv({
    GEMINI_API_KEY: "test-key",
    GEMINI_REQUEST_TIMEOUT_MS: "invalid",
    GEMINI_RETRY_ATTEMPTS: "0"
  }, () => {
    const status = getGeminiRuntimeStatus();
    assert.equal(status.requestTimeoutMs, 25000);
    assert.equal(status.retryAttempts, 1);
  });
});

test("invalid model configuration is reported as not ready", () => {
  withEnv({
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: "not a valid model name",
    GEMINI_CHAT_ENABLED: "true",
    GEMINI_WEB_RESEARCH_ENABLED: "true"
  }, () => {
    const status = getGeminiRuntimeStatus();
    assert.equal(status.configured, true);
    assert.equal(status.modelValid, false);
    assert.equal(status.model, "invalid-model");
    assert.equal(status.plannerEnabled, false);
    assert.equal(status.conversationEnabled, false);
    assert.equal(status.webResearchEnabled, false);
    assert.throws(() => getGeminiModel(), /valid model identifier/i);
  });
});

test("the default model is configurable and preserved as an environment override", () => {
  withEnv({ GEMINI_MODEL: "gemini-4-argon" }, () => {
    assert.equal(getGeminiModel(), "gemini-4-argon");
  });
});
