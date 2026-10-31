import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAgentPlan } from "../services/agent-planner.js";

test("agent planner accepts only a short allow-listed action plan", () => {
  const plan = validateAgentPlan({
    reply: "I will open YouTube and search.",
    actions: [
      { type: "open_app", value: "YouTube", purpose: "Open the app" },
      { type: "tap_label", value: "Search", purpose: "Open search" },
      { type: "type_text", value: "JEE Physics", purpose: "Enter query" },
      { type: "ask_user", value: "Choose the result you want.", purpose: "Avoid guessing" }
    ]
  });
  assert.equal(plan.actions.length, 4);
  assert.equal(plan.actions[0].type, "open_app");
});

test("agent planner rejects protected actions and secret-like numeric text", () => {
  assert.throws(() => validateAgentPlan({
    reply: "Send it",
    actions: [{ type: "tap_label", value: "Send", purpose: "Send message" }]
  }), /protected action/i);

  assert.throws(() => validateAgentPlan({
    reply: "Type this",
    actions: [{ type: "type_text", value: "123456", purpose: "Code" }]
  }), /typing policy/i);
});

test("agent planner rejects arbitrary action names and oversized plans", () => {
  assert.throws(() => validateAgentPlan({
    reply: "Run this",
    actions: [{ type: "shell", value: "rm -rf", purpose: "bad" }]
  }), /unsupported/i);

  assert.throws(() => validateAgentPlan({
    reply: "Too much",
    actions: Array.from({ length: 7 }, () => ({
      type: "scroll_down", value: "", purpose: "scroll"
    }))
  }), /one and six/i);
});
