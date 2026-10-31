import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConversationContents, isConversationAIEnabled } from "../services/conversation.js";

test("conversation context is bounded and only includes user and assistant text", () => {
  const history = [
    { role: "system", content: "must not be forwarded" },
    ...Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "turn-" + index + "-".repeat(1400)
    }))
  ];
  const contents = buildConversationContents("Follow-up question", history);
  assert.equal(contents.length, 9);
  assert.equal(contents[0].role, "user");
  assert.equal(contents[0].parts[0].text.startsWith("turn-4"), true);
  assert.equal(contents[0].parts[0].text.length, 1200);
  assert.equal(contents.at(-1).parts[0].text, "Follow-up question");
  assert.equal(contents.some((item) => item.parts[0].text.includes("must not be forwarded")), false);
});

test("conversation mode stays disabled unless both opt-in and API key are present", () => {
  const oldEnabled = process.env.GEMINI_CHAT_ENABLED;
  const oldKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_CHAT_ENABLED = "true";
    process.env.GEMINI_API_KEY = "";
    assert.equal(isConversationAIEnabled(), false);
    process.env.GEMINI_API_KEY = "test-only-key";
    assert.equal(isConversationAIEnabled(), true);
    process.env.GEMINI_CHAT_ENABLED = "false";
    assert.equal(isConversationAIEnabled(), false);
  } finally {
    if (oldEnabled === undefined) delete process.env.GEMINI_CHAT_ENABLED;
    else process.env.GEMINI_CHAT_ENABLED = oldEnabled;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});
