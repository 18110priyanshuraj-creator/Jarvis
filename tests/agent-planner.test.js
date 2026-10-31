import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAgentPlan } from "../services/agent-planner.js";

test("agent planner accepts only a short allow-listed action plan", () => {
  const plan = validateAgentPlan({
    mode: "device_action",
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

test("agent planner separates conversation and clarification from device actions", () => {
  const conversation = validateAgentPlan({
    mode: "conversation",
    reply: "",
    actions: []
  });
  assert.equal(conversation.mode, "conversation");
  assert.deepEqual(conversation.actions, []);

  const clarification = validateAgentPlan({
    mode: "clarification",
    reply: "Which app should I open?",
    actions: []
  });
  assert.equal(clarification.mode, "clarification");
  assert.equal(clarification.reply, "Which app should I open?");

  assert.throws(() => validateAgentPlan({
    mode: "conversation",
    reply: "Opening an app",
    actions: [{ type: "open_app", value: "YouTube", purpose: "Open app" }]
  }), /must not contain device actions/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Open app",
    actions: []
  }), /between one and six actions/i);
});

test("agent planner rejects protected actions and secret-like numeric text", () => {
  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Send it",
    actions: [{ type: "tap_label", value: "Send", purpose: "Send message" }]
  }), /protected action/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Type this",
    actions: [{ type: "type_text", value: "123456", purpose: "Code" }]
  }), /typing policy/i);
});

test("agent planner rejects arbitrary action names and oversized plans", () => {
  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Run this",
    actions: [{ type: "shell", value: "rm -rf", purpose: "bad" }]
  }), /unsupported/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Too much",
    actions: Array.from({ length: 7 }, () => ({
      type: "scroll_down", value: "", purpose: "scroll"
    }))
  }), /one and six/i);
});
