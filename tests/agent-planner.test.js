import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalAgentPlan, validateAgentPlan } from "../services/agent-planner.js";

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


test("offline device planner builds a bounded English app-search workflow", () => {
  const plan = createLocalAgentPlan("Open YouTube and search for JEE Physics");
  assert.ok(plan);
  assert.equal(plan.mode, "device_action");
  assert.deepEqual(plan.actions.map((item) => item.type), [
    "open_app", "tap_label", "type_text", "ask_user"
  ]);
  assert.equal(plan.actions[0].value, "YouTube");
  assert.equal(plan.actions[1].value, "Search");
  assert.equal(plan.actions[2].value, "JEE Physics");
  assert.match(plan.actions[3].value, /choose the result/i);
});

test("offline device planner supports Hindi and Hinglish search phrasing", () => {
  const hindi = createLocalAgentPlan("YouTube kholo aur JEE Physics search karo");
  assert.ok(hindi);
  assert.equal(hindi.actions[0].value, "YouTube");
  assert.equal(hindi.actions[2].value, "JEE Physics");

  const reversed = createLocalAgentPlan("Search for circular motion on YouTube");
  assert.ok(reversed);
  assert.equal(reversed.actions[0].value, "YouTube");
  assert.equal(reversed.actions[2].value, "circular motion");

  const hinglish = createLocalAgentPlan("YouTube par mole concept search karo");
  assert.ok(hinglish);
  assert.equal(hinglish.actions[2].value, "mole concept");
});

test("offline planner declines ambiguous, secret-like, and restricted searches", () => {
  assert.equal(createLocalAgentPlan("Open YouTube and do something"), null);
  assert.equal(createLocalAgentPlan("Open YouTube and search for 123456"), null);
  assert.equal(createLocalAgentPlan("Open YouTube and search for how to make a bomb"), null);
  assert.equal(createLocalAgentPlan("Open YouTube and search for adult content"), null);
});
