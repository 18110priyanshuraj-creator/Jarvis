import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, getNluCapabilities } from "../services/nlu.js";

test("classifies common English, Hindi and Hinglish intents", () => {
  const cases = [
    ["hello", "greeting"], ["who are you", "identity"],
    ["what can you do", "capabilities"], ["calculate 12*4", "calculator"],
    ["show my tasks", "task_lookup"], ["show memories", "notes_lookup"],
    ["what time is it", "time_date"], ["thanks", "gratitude"],
    ["open YouTube", "app_request"], ["latest JEE news", "current_information"],
    ["explain Newton laws", "knowledge_question"], ["namaste", "greeting"],
    ["tum kaun ho", "identity"], ["kya kar sakte ho", "capabilities"],
    ["mere tasks dikhao", "task_lookup"], ["aaj kya date hai", "time_date"],
    ["shukriya", "gratitude"], ["photosynthesis kya hota hai", "knowledge_question"]
  ];
  for (const [message, expected] of cases) {
    assert.equal(classifyIntent(message).intent, expected, message);
  }
});

test("returns bounded confidence and language metadata", () => {
  for (const message of ["hello", "नमस्ते", "mere tasks dikhao", "unknown request"]) {
    const result = classifyIntent(message);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    assert.ok(["en", "hi", "hinglish"].includes(result.language));
  }
});

test("does not classify ambiguous text as an executable action", () => {
  const result = classifyIntent("maybe do something with my tablet");
  assert.equal(result.intent, "general_question");
  assert.equal(result.matchedRule, null);
  assert.equal(getNluCapabilities().classificationExecutesActions, false);
});

test("handles empty and non-string values", () => {
  assert.equal(classifyIntent("").intent, "unknown");
  assert.equal(classifyIntent(null).intent, "unknown");
});
