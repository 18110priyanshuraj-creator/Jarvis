import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceWorkflowRun,
  approveWorkflow,
  cancelWorkflowRun,
  createWorkflowDraft,
  createWorkflowRun,
  pauseWorkflow,
  updateWorkflowDraft,
  validateWorkflow
} from "../services/workflow-engine.js";

function sampleWorkflow() {
  return createWorkflowDraft({
    name: "Study preparation",
    description: "Prepare a study session using saved notes.",
    steps: [
      { type: "create_task", title: "Revise mole concept", description: "Review the limiting reagent examples." },
      { type: "search_knowledge", title: "Find chemistry notes", query: "mole concept" },
      { type: "review_checkpoint", title: "Review the plan", message: "Check the results before continuing." },
      { type: "draft_text", title: "Prepare a study checklist", content: "1. Revise definitions.\n2. Solve two examples.\n3. Review mistakes." }
    ]
  });
}

test("workflow drafts accept only the small allow-listed local action set", () => {
  const workflow = sampleWorkflow();
  assert.equal(workflow.status, "draft");
  assert.equal(workflow.steps.length, 4);
  assert.throws(() => createWorkflowDraft({
    name: "Unsupported automation",
    steps: [{ type: "run_shell", title: "Run a command", command: "rm -rf ." }]
  }), /unsupported step type/i);
});

test("workflow draft validates its structure without executing any steps", () => {
  const result = validateWorkflow(sampleWorkflow());
  assert.equal(result.validation.passed, true);
  assert.equal(result.validation.mode, "static-workflow-validation");
  assert.match(result.validation.note, /does not execute/i);
  assert.equal(result.workflow.status, "draft");
});

test("long workflows require an explicit review checkpoint", () => {
  const workflow = createWorkflowDraft({
    name: "Long workflow",
    steps: [
      { type: "draft_text", title: "Draft first item", content: "Create a short draft of this first review item." },
      { type: "draft_text", title: "Draft second item", content: "Create a short draft of this second review item." },
      { type: "draft_text", title: "Draft third item", content: "Create a short draft of this third review item." },
      { type: "draft_text", title: "Draft fourth item", content: "Create a short draft of this fourth review item." }
    ]
  });
  assert.equal(validateWorkflow(workflow).validation.passed, false);
});

test("sensitive values and contact details are rejected", () => {
  assert.throws(() => createWorkflowDraft({
    name: "Save secret",
    steps: [{ type: "save_memory", title: "Save credential", content: "My API key is secret: abc12345" }]
  }), /private or sensitive/i);
  assert.throws(() => createWorkflowDraft({
    name: "Contact note",
    steps: [{ type: "draft_text", title: "Contact", content: "Call me at +1 202 555 0148 tomorrow." }]
  }), /private or sensitive/i);
});

test("approval requires current validation and pause prevents new runs", () => {
  const workflow = sampleWorkflow();
  assert.throws(() => approveWorkflow(workflow), /pass validation/i);
  const approved = approveWorkflow(validateWorkflow(workflow).workflow);
  assert.equal(approved.status, "approved");
  assert.ok(approved.approvedAt);
  const paused = pauseWorkflow(approved);
  assert.equal(paused.status, "paused");
  assert.throws(() => createWorkflowRun(paused), /approved workflow/i);
});

test("editing an approved workflow creates a new unapproved version", () => {
  const approved = approveWorkflow(validateWorkflow(sampleWorkflow()).workflow);
  const updated = updateWorkflowDraft(approved, {
    name: "Study preparation v2",
    description: "Add one extra revision step.",
    steps: [
      { type: "create_task", title: "Revise physics", description: "Review circular motion." }
    ]
  });
  assert.equal(updated.id, approved.id);
  assert.equal(updated.version, 2);
  assert.equal(updated.status, "draft");
  assert.equal(updated.validation, null);
  assert.throws(() => createWorkflowRun(updated), /approved workflow/i);
});

test("runner executes allow-listed local steps and pauses at a review checkpoint", async () => {
  const workflow = approveWorkflow(validateWorkflow(sampleWorkflow()).workflow);
  const run = createWorkflowRun(workflow);
  const called = [];
  const handlers = {
    create_task: async (step) => { called.push(step.type); return { taskId: "task-1", summary: "Task created." }; },
    search_knowledge: async (step) => { called.push(step.type); return { matches: 2, summary: "Two notes found." }; },
    draft_text: async (step) => { called.push(step.type); return { draft: step.content, summary: "Draft prepared." }; }
  };
  const waiting = await advanceWorkflowRun(run, handlers);
  assert.equal(waiting.status, "waiting_review");
  assert.equal(waiting.nextStepIndex, 3);
  assert.deepEqual(called, ["create_task", "search_knowledge"]);
  assert.equal(waiting.steps[2].status, "waiting_review");

  const resumed = await advanceWorkflowRun({ ...waiting, status: "running" }, handlers);
  assert.equal(resumed.status, "completed");
  assert.deepEqual(called, ["create_task", "search_knowledge", "draft_text"]);
  assert.equal(resumed.steps[3].result.draft.includes("limiting"), false);
  assert.ok(resumed.finishedAt);
});

test("runner failure stops later steps and logs a bounded failure result", async () => {
  const workflow = approveWorkflow(validateWorkflow(sampleWorkflow()).workflow);
  const run = createWorkflowRun(workflow);
  const failed = await advanceWorkflowRun(run, {
    create_task: async () => { throw new Error("Local task store is unavailable."); }
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.steps[0].status, "failed");
  assert.equal(failed.steps[1].status, "pending");
  assert.equal(failed.logs.at(-1).status, "failed");
});

test("user can stop a paused run and all remaining steps are skipped", async () => {
  const workflow = approveWorkflow(validateWorkflow(sampleWorkflow()).workflow);
  const run = createWorkflowRun(workflow);
  const waiting = await advanceWorkflowRun(run, {
    create_task: async () => ({ summary: "Task created." }),
    search_knowledge: async () => ({ summary: "Notes found." })
  });
  const cancelled = cancelWorkflowRun(waiting);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.steps[3].status, "skipped");
  assert.throws(() => cancelWorkflowRun(cancelled), /active workflow run/i);
});

test("runner cannot start a second time from a completed run", async () => {
  const workflow = approveWorkflow(validateWorkflow(createWorkflowDraft({
    name: "Small draft",
    steps: [{ type: "draft_text", title: "Prepare a note", content: "Prepare a safe local note for later review." }]
  })).workflow);
  const run = createWorkflowRun(workflow);
  const completed = await advanceWorkflowRun(run, {
    draft_text: async () => ({ summary: "Draft prepared." })
  });
  assert.equal(completed.status, "completed");
  await assert.rejects(() => advanceWorkflowRun(completed, {}), /only a running workflow/i);
});
