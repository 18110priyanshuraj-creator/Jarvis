import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceWorkflowRun,
  classifyWorkflowError,
  getWorkflowRecoverySummary,
  approveWorkflow,
  cancelWorkflowRun,
  createWorkflowDraft,
  createWorkflowRun,
  pauseWorkflow,
  pauseWorkflowRun,
  recoverInterruptedWorkflowRuns,
  resumeWorkflowRun,
  retryWorkflowRun,
  WORKFLOW_STEP_TIMEOUT_MS,
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

test("workflow drafts accept only the four predefined read-only integration actions", () => {
  const workflow = createWorkflowDraft({
    name: "Read connected services",
    steps: [
      { type: "github_list_repositories", title: "List GitHub repositories" },
      { type: "google_drive_list_files", title: "List recent Drive files" },
      { type: "telegram_get_bot_profile", title: "Check Telegram bot profile" },
      { type: "elevenlabs_get_account", title: "Read ElevenLabs account" },
      { type: "review_checkpoint", title: "Review service results" }
    ]
  });
  const result = validateWorkflow(workflow);
  assert.equal(result.validation.passed, true);
  assert.deepEqual(result.workflow.steps.slice(0, 4).map((step) => step.type), [
    "github_list_repositories",
    "google_drive_list_files",
    "telegram_get_bot_profile",
    "elevenlabs_get_account"
  ]);
  assert.throws(() => createWorkflowDraft({
    name: "Arbitrary integration",
    steps: [{ type: "http_request", title: "Fetch a custom URL", url: "https://example.com" }]
  }), /unsupported step type/i);
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


test("runner persists a pre-action and post-action checkpoint for every step", async () => {
  const workflow = approveWorkflow(validateWorkflow(createWorkflowDraft({
    name: "Checkpoint workflow",
    steps: [
      { type: "draft_text", title: "Prepare first draft", content: "Prepare a safe first draft for checkpoint testing." },
      { type: "draft_text", title: "Prepare second draft", content: "Prepare a safe second draft for checkpoint testing." }
    ]
  })).workflow);
  const run = createWorkflowRun(workflow);
  const checkpoints = [];
  const completed = await advanceWorkflowRun(run, {
    draft_text: async (step) => ({ executionKey: step.executionKey, summary: "Draft prepared." })
  }, {
    onCheckpoint: async (snapshot) => checkpoints.push(snapshot)
  });

  assert.equal(completed.status, "completed");
  assert.equal(checkpoints.length, 5);
  assert.equal(checkpoints[0].steps[0].status, "running");
  assert.equal(checkpoints[1].steps[0].status, "completed");
  assert.equal(checkpoints[2].steps[1].status, "running");
  assert.equal(checkpoints[3].steps[1].status, "completed");
  assert.equal(checkpoints[4].status, "completed");
  assert.equal(checkpoints[0].steps[0].executionKey, run.id + ":0");
});

test("pause requests are honored at the next safe checkpoint and can resume", async () => {
  const workflow = approveWorkflow(validateWorkflow(createWorkflowDraft({
    name: "Pause and resume workflow",
    steps: [
      { type: "draft_text", title: "Prepare first draft", content: "Prepare a safe first draft before pausing." },
      { type: "draft_text", title: "Prepare second draft", content: "Prepare a safe second draft after resuming." }
    ]
  })).workflow);
  const run = createWorkflowRun(workflow);
  let pause = false;
  const called = [];
  const paused = await advanceWorkflowRun(run, {
    draft_text: async (step) => { called.push(step.title); return { summary: "Draft prepared." }; }
  }, {
    shouldPause: () => pause,
    onCheckpoint: async (snapshot) => {
      if (snapshot.steps[0]?.status === "completed") pause = true;
    }
  });

  assert.equal(paused.status, "paused");
  assert.equal(paused.nextStepIndex, 1);
  assert.deepEqual(called, ["Prepare first draft"]);
  const resumed = resumeWorkflowRun(paused);
  const completed = await advanceWorkflowRun(resumed, {
    draft_text: async (step) => { called.push(step.title); return { summary: "Draft prepared." }; }
  });
  assert.equal(completed.status, "completed");
  assert.deepEqual(called, ["Prepare first draft", "Prepare second draft"]);
});

test("restart recovery pauses active runs and preserves the next durable checkpoint", async () => {
  const workflow = approveWorkflow(validateWorkflow(sampleWorkflow()).workflow);
  const run = createWorkflowRun(workflow);
  const interrupted = {
    ...run,
    status: "running",
    currentStepIndex: 1,
    nextStepIndex: 1,
    steps: run.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? "completed" : index === 1 ? "running" : "pending"
    }))
  };
  const [recovered] = recoverInterruptedWorkflowRuns([interrupted], "2026-11-02T08:00:00.000Z");
  assert.equal(recovered.status, "paused");
  assert.equal(recovered.steps[0].status, "completed");
  assert.equal(recovered.steps[1].status, "pending");
  assert.equal(recovered.steps[1].recoveredFromInterrupted, true);
  assert.equal(recovered.nextStepIndex, 1);
  assert.equal(recovered.recovery.reason, "process_restart");
  assert.equal(recovered.recovery.requiresManualResume, true);
  assert.equal(resumeWorkflowRun(recovered).status, "running");
  assert.deepEqual(recoverInterruptedWorkflowRuns([recovered]), [recovered]);
});

test("a stop request is observed before the next action and paused runs can be cancelled", async () => {
  const workflow = approveWorkflow(validateWorkflow(createWorkflowDraft({
    name: "Safe stop workflow",
    steps: [
      { type: "draft_text", title: "Prepare first draft", content: "Prepare a safe first draft before stopping." },
      { type: "draft_text", title: "Prepare second draft", content: "This second draft must not execute after stop." }
    ]
  })).workflow);
  const run = createWorkflowRun(workflow);
  let stop = false;
  const called = [];
  const stopped = await advanceWorkflowRun(run, {
    draft_text: async (step) => { called.push(step.title); return { summary: "Draft prepared." }; }
  }, {
    shouldCancel: () => stop,
    onCheckpoint: async (snapshot) => {
      if (snapshot.steps[0]?.status === "completed") stop = true;
    }
  });
  assert.equal(stopped.status, "cancelled");
  assert.deepEqual(called, ["Prepare first draft"]);
  assert.throws(() => cancelWorkflowRun(stopped), /active workflow run/i);

  const paused = { ...run, status: "paused" };
  assert.equal(cancelWorkflowRun(paused).status, "cancelled");
  assert.throws(() => pauseWorkflowRun(paused), /queued or running/i);
  const queuedPaused = pauseWorkflowRun({ ...run, status: "queued" });
  assert.equal(queuedPaused.status, "paused");
  assert.equal(queuedPaused.nextStepIndex, run.nextStepIndex);
});


test("workflow failure classification exposes safe, actionable categories", () => {
  assert.deepEqual(classifyWorkflowError(new Error("Request timed out after 25000 ms.")), {
    code: "timeout", category: "transient", retryable: true,
    message: "The step timed out. Check whether it completed before retrying."
  });
  assert.equal(classifyWorkflowError(new Error("The service rate limit was reached (429).")).code, "rate_limited");
  assert.equal(classifyWorkflowError(new Error("Could not connect to the external service.")).code, "network_unavailable");
  assert.equal(classifyWorkflowError(new Error("GitHub is not configured.")).code, "configuration_missing");
  assert.equal(classifyWorkflowError(new Error("The service rejected the configured credential.")).code, "authentication_required");
  assert.equal(classifyWorkflowError(new Error("The account lacks permission.")).code, "permission_denied");
  assert.equal(classifyWorkflowError(new Error("Task limit reached.")).code, "resource_limit");
  assert.equal(classifyWorkflowError(new Error("An unfamiliar failure occurred.")).retryable, false);
});

test("failed workflow records contain sanitized error summaries rather than raw exception text", async () => {
  const workflow = approveWorkflow(validateWorkflow(createWorkflowDraft({
    name: "Sanitized recovery test",
    steps: [{ type: "draft_text", title: "Prepare a draft", content: "Prepare a safe draft for sanitized failure testing." }]
  })).workflow);
  const run = createWorkflowRun(workflow);
  const secretLikeMessage = "Connection failed while request contained bearer abcdefghijklmnop and user@example.com.";
  const failed = await advanceWorkflowRun(run, {
    draft_text: async () => { throw new Error(secretLikeMessage); }
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failure.code, "network_unavailable");
  assert.equal(failed.failure.retryable, true);
  assert.ok(failed.steps[0].result.error.includes("connection"));
  assert.equal(JSON.stringify(failed).includes("abcdefghijklmnop"), false);
  assert.equal(JSON.stringify(failed).includes("user@example.com"), false);
});

test("recovery preview separates manual retries from fixes and never schedules automatic recovery", async () => {
  const workflow = approveWorkflow(validateWorkflow(createWorkflowDraft({
    name: "Recovery preview",
    steps: [{ type: "draft_text", title: "Prepare a draft", content: "Prepare a safe draft for recovery preview testing." }]
  })).workflow);
  const run = createWorkflowRun(workflow);
  const transient = await advanceWorkflowRun(run, {
    draft_text: async () => { throw new Error("Temporary writer connection unavailable."); }
  });
  const preview = getWorkflowRecoverySummary(transient);
  assert.equal(preview.canRetry, true);
  assert.equal(preview.canResume, false);
  assert.equal(preview.automaticRecovery, false);
  assert.equal(preview.nextAction, "retry_manually");
  assert.equal(preview.attempts, 1);
  assert.equal(preview.maxAttempts, 3);
  assert.equal(preview.failure.code, "network_unavailable");

  const permanent = await advanceWorkflowRun(createWorkflowRun(workflow), {
    draft_text: async () => { throw new Error("The integration is not configured."); }
  });
  const permanentPreview = getWorkflowRecoverySummary(permanent);
  assert.equal(permanentPreview.canRetry, false);
  assert.equal(permanentPreview.nextAction, "review_or_fix");
  assert.equal(permanentPreview.failure.code, "configuration_missing");
});

test("non-transient workflow failures cannot be manually retried", async () => {
  const workflow = approveWorkflow(validateWorkflow(createWorkflowDraft({
    name: "Do not retry configuration",
    steps: [{ type: "draft_text", title: "Prepare a draft", content: "Prepare a safe draft for non-retryable configuration testing." }]
  })).workflow);
  const failed = await advanceWorkflowRun(createWorkflowRun(workflow), {
    draft_text: async () => { throw new Error("Provider credential is not configured."); }
  });
  assert.equal(failed.failure.code, "configuration_missing");
  assert.throws(() => retryWorkflowRun(failed), /not safe to retry/i);
});

test("manual retry replays only the failed step with a bounded attempt count", async () => {
  const workflow = approveWorkflow(validateWorkflow(createWorkflowDraft({
    name: "Retry a failed local draft",
    steps: [
      { type: "draft_text", title: "Prepare first draft", content: "Prepare a safe first draft before retry testing." },
      { type: "draft_text", title: "Prepare second draft", content: "Prepare a safe second draft after retry testing." }
    ]
  })).workflow);
  const run = createWorkflowRun(workflow);
  let secondAttempts = 0;
  const failed = await advanceWorkflowRun(run, {
    draft_text: async (step) => {
      if (step.title === "Prepare second draft" && secondAttempts++ === 0) {
        throw new Error("Temporary local writer error.");
      }
      return { summary: "Draft prepared." };
    }
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.steps[0].status, "completed");
  assert.equal(failed.steps[1].attempts, 1);

  const retry = retryWorkflowRun(failed);
  assert.equal(retry.status, "running");
  assert.equal(retry.nextStepIndex, 1);
  assert.equal(retry.steps[0].status, "completed");
  assert.equal(retry.steps[1].status, "pending");
  assert.match(retry.logs.at(-1).summary, /manual retry/i);
  const completed = await advanceWorkflowRun(retry, {
    draft_text: async () => ({ summary: "Draft prepared." })
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.steps[0].attempts, 1);
  assert.equal(completed.steps[1].attempts, 2);

  const exhausted = {
    ...failed,
    steps: failed.steps.map((step, index) => index === 1 ? { ...step, attempts: 3 } : step)
  };
  assert.throws(() => retryWorkflowRun(exhausted), /maximum of three attempts/i);
});


test("workflow step timeout fails only the current step and prevents later work", async () => {
  const workflow = approveWorkflow(validateWorkflow(createWorkflowDraft({
    name: "Timeout workflow",
    steps: [
      { type: "draft_text", title: "Slow draft", content: "Prepare a draft that intentionally takes too long." },
      { type: "draft_text", title: "Later draft", content: "This step must not run after a timeout." }
    ]
  })).workflow);
  const run = createWorkflowRun(workflow);
  let laterCalled = false;
  const failed = await advanceWorkflowRun(run, {
    draft_text: async (step) => {
      if (step.title === "Slow draft") {
        await new Promise((resolve) => setTimeout(resolve, 180));
        return { summary: "Late draft result." };
      }
      laterCalled = true;
      return { summary: "Should not run." };
    }
  }, { stepTimeoutMs: 100 });

  assert.equal(WORKFLOW_STEP_TIMEOUT_MS, 60_000);
  assert.equal(failed.status, "failed");
  assert.equal(failed.steps[0].status, "failed");
  assert.equal(failed.steps[0].result.failure.code, "timeout");
  assert.equal(failed.steps[0].result.failure.retryable, true);
  assert.equal(failed.steps[0].result.error.includes("100 ms"), false);
  assert.equal(failed.steps[1].status, "pending");
  assert.equal(laterCalled, false);
});
