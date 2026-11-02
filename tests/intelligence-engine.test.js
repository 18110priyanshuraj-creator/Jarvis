import { test } from "node:test";
import assert from "node:assert/strict";
import { getIntelligenceStatus, resolveOfflineAssistantTurn } from "../services/intelligence-engine.js";

test("intelligence router resolves covered questions locally with explicit metadata", () => {
  const result = resolveOfflineAssistantTurn({ message: "What is (25 * 4) + 10?" });
  assert.ok(result);
  assert.match(result.answer, /110/);
  assert.equal(result.engine, "built-in-offline");
  assert.equal(result.externalAI, false);
  assert.equal(result.intelligencePath, "offline-first");
});

test("intelligence router leaves unsupported questions for the configured fallback", () => {
  assert.equal(resolveOfflineAssistantTurn({ message: "Who won a game that happened a minute ago?" }), null);
});

test("public intelligence status reports honest local and optional model capabilities without secrets", () => {
  const status = getIntelligenceStatus({
    provider: "jarvis-self-hosted",
    configured: true,
    enabled: true,
    conversationEnabled: true,
    plannerEnabled: false,
    baseUrl: "https://private.example",
    apiKey: "must-not-leak",
    model: "private-model-name"
  });
  assert.equal(status.localEngine.available, true);
  assert.equal(status.localEngine.generalPurposeLanguageModel, false);
  assert.equal(status.optionalModelAdapter.conversationEnabled, true);
  assert.equal(status.optionalModelAdapter.plannerEnabled, false);
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes("must-not-leak"), false);
  assert.equal(serialized.includes("private.example"), false);
  assert.equal(serialized.includes("private-model-name"), false);
});
