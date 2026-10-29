import { test } from "node:test";
import assert from "node:assert/strict";
import { runLocalBrain, searchLocalKnowledge } from "../brain.js";

test("offline brain calculates arithmetic without a model", () => {
  const answer = runLocalBrain({ message: "What is (25 * 4) + 10?" });
  assert.match(answer, /110/);
  assert.match(answer, /calculated locally/i);
});

test("offline calculator rejects division by zero safely", () => {
  const answer = runLocalBrain({ message: "calculate 8 / 0" });
  assert.match(answer, /could not safely evaluate/i);
});

test("offline brain answers an embedded study topic", () => {
  const answer = runLocalBrain({ message: "Explain Newton's laws of motion" });
  assert.match(answer, /F = ma/);
  assert.match(answer, /free-body diagram/i);
});

test("offline brain can list locally saved tasks", () => {
  const answer = runLocalBrain({
    message: "show my tasks",
    tasks: [{ id: "task-1", title: "Revise sets", description: "", done: false }]
  });
  assert.match(answer, /Revise sets/);
  assert.match(answer, /OPEN/);
});

test("unsupported requests are not fabricated", () => {
  const answer = runLocalBrain({ message: "Who won a game that happened a minute ago?" });
  assert.match(answer, /offline rule set/i);
});

test("local knowledge search uses bundled entries", () => {
  const results = searchLocalKnowledge("mole concept limiting reagent");
  assert.ok(results.length > 0);
  assert.equal(results[0].title, "Mole concept");
});
