import crypto from "node:crypto";

export const WORKFLOW_STEP_TYPES = Object.freeze([
  "create_task",
  "save_memory",
  "search_knowledge",
  "draft_text",
  "review_checkpoint"
]);

const WORKFLOW_STATUSES = new Set(["draft", "approved", "paused"]);
const RUN_STATUSES = new Set(["running", "waiting_review", "completed", "failed", "cancelled"]);
const MAX_WORKFLOWS = 50;
const MAX_RUNS = 100;
const MAX_STEPS = 10;
const MAX_TITLE = 100;
const MAX_DESCRIPTION = 600;

const SENSITIVE_VALUE_PATTERN =
  /\b(?:api[_ -]?key|password|passcode|bearer\s+[a-z0-9._-]{8,}|secret\s*[:=]|private key|otp|one.?time password)\b/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{8,}\d)/;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.normalize("NFKC").trim().slice(0, maxLength) : "";
}

function safeValue(value) {
  return !SENSITIVE_VALUE_PATTERN.test(value) && !EMAIL_PATTERN.test(value) && !PHONE_PATTERN.test(value);
}

function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return new Date().toISOString();
  return new Date(Date.parse(value)).toISOString();
}

function normalizeStep(raw = {}) {
  const type = WORKFLOW_STEP_TYPES.includes(raw.type) ? raw.type : "";
  if (!type) throw new TypeError("Workflow contains an unsupported step type.");
  const title = cleanText(raw.title, MAX_TITLE);
  if (title.length < 3) throw new TypeError("Every workflow step needs a short title.");

  if (type === "create_task") {
    const description = cleanText(raw.description, 600);
    if (!safeValue(title + " " + description)) throw new TypeError("Task step contains private or sensitive content.");
    return { type, title, description };
  }
  if (type === "save_memory") {
    const content = cleanText(raw.content, 500);
    const category = ["preference", "goal", "fact"].includes(raw.category) ? raw.category : "fact";
    if (content.length < 3 || !safeValue(content)) throw new TypeError("Memory step needs safe content between 3 and 500 characters.");
    return { type, title, content, category };
  }
  if (type === "search_knowledge") {
    const query = cleanText(raw.query, 200);
    if (query.length < 3 || !safeValue(query)) throw new TypeError("Knowledge search needs a safe query of at least 3 characters.");
    return { type, title, query };
  }
  if (type === "draft_text") {
    const content = cleanText(raw.content, 2000);
    if (content.length < 10 || !safeValue(content)) throw new TypeError("Draft step needs safe text between 10 and 2,000 characters.");
    return { type, title, content };
  }
  const message = cleanText(raw.message, 300);
  if (!safeValue(message)) throw new TypeError("Review checkpoint contains private or sensitive content.");
  return { type, title, message };
}

export function normalizeWorkflow(input = {}) {
  const steps = Array.isArray(input.steps) ? input.steps.slice(0, MAX_STEPS).map(normalizeStep) : [];
  const status = WORKFLOW_STATUSES.has(input.status) ? input.status : "draft";
  const validation = input.validation && typeof input.validation === "object" ? input.validation : null;
  const version = Number.isInteger(input.version) && input.version > 0 ? input.version : 1;
  return {
    id: cleanText(input.id, 80) || crypto.randomUUID(),
    name: cleanText(input.name, MAX_TITLE),
    description: cleanText(input.description, MAX_DESCRIPTION),
    steps,
    version,
    status,
    validation,
    approvedAt: cleanText(input.approvedAt, 80),
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt)
  };
}

export function createWorkflowDraft(input = {}) {
  const name = cleanText(input.name, MAX_TITLE);
  const description = cleanText(input.description, MAX_DESCRIPTION);
  if (name.length < 3) throw new TypeError("Workflow name must contain at least 3 characters.");
  if (!safeValue(name + " " + description)) throw new TypeError("Workflow name or description contains private or sensitive content.");
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > MAX_STEPS) {
    throw new TypeError("A workflow needs between 1 and 10 steps.");
  }
  const now = new Date().toISOString();
  return normalizeWorkflow({
    id: crypto.randomUUID(),
    name,
    description,
    steps: input.steps,
    version: 1,
    status: "draft",
    validation: null,
    approvedAt: "",
    createdAt: now,
    updatedAt: now
  });
}

export function updateWorkflowDraft(workflowInput, input = {}) {
  const workflow = normalizeWorkflow(workflowInput);
  const next = createWorkflowDraft({
    name: input.name,
    description: input.description,
    steps: input.steps
  });
  return normalizeWorkflow({
    ...next,
    id: workflow.id,
    version: workflow.version + 1,
    createdAt: workflow.createdAt,
    updatedAt: new Date().toISOString()
  });
}

export function validateWorkflow(workflowInput) {
  const workflow = normalizeWorkflow(workflowInput);
  const checks = [
    { name: "Workflow name", passed: workflow.name.length >= 3 },
    { name: "Step count", passed: workflow.steps.length >= 1 && workflow.steps.length <= MAX_STEPS },
    { name: "Allowed step types", passed: workflow.steps.every((step) => WORKFLOW_STEP_TYPES.includes(step.type)) },
    { name: "Sensitive text screening", passed: workflow.steps.every((step) => Object.values(step).every((value) => typeof value !== "string" || safeValue(value))) },
    { name: "Review checkpoint", passed: workflow.steps.length <= 3 || workflow.steps.some((step) => step.type === "review_checkpoint") }
  ];
  const validation = {
    version: workflow.version,
    passed: checks.every((item) => item.passed),
    checks,
    testedAt: new Date().toISOString(),
    mode: "static-workflow-validation",
    note: "Validation checks structure and allow-listed actions. It does not execute the workflow."
  };
  return {
    workflow: normalizeWorkflow({ ...workflow, validation, updatedAt: validation.testedAt }),
    validation
  };
}

export function approveWorkflow(workflowInput) {
  const workflow = normalizeWorkflow(workflowInput);
  if (!workflow.validation?.passed || workflow.validation.version !== workflow.version) {
    throw new Error("Run and pass validation for the current workflow version before approving it.");
  }
  return normalizeWorkflow({
    ...workflow,
    status: "approved",
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

export function pauseWorkflow(workflowInput) {
  const workflow = normalizeWorkflow(workflowInput);
  if (workflow.status !== "approved") throw new Error("Only an approved workflow can be paused.");
  return normalizeWorkflow({ ...workflow, status: "paused", updatedAt: new Date().toISOString() });
}

function addLog(run, entry) {
  run.logs.push({
    at: new Date().toISOString(),
    stepIndex: entry.stepIndex,
    stepTitle: cleanText(entry.stepTitle, MAX_TITLE),
    status: entry.status,
    summary: cleanText(entry.summary, 300)
  });
  run.logs = run.logs.slice(-50);
}

export function createWorkflowRun(workflowInput) {
  const workflow = normalizeWorkflow(workflowInput);
  if (workflow.status !== "approved" || !workflow.approvedAt) {
    throw new Error("Only an approved workflow can be run.");
  }
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowVersion: workflow.version,
    steps: workflow.steps.map((step) => ({ ...step, status: "pending", result: null })),
    nextStepIndex: 0,
    status: "running",
    logs: [],
    createdAt: now,
    updatedAt: now,
    finishedAt: ""
  };
}

export async function advanceWorkflowRun(runInput, handlers) {
  const run = structuredClone(runInput);
  if (run.status !== "running") throw new Error("Only a running workflow can advance.");
  if (!handlers || typeof handlers !== "object") throw new TypeError("Workflow handlers are required.");

  for (const step of run.steps) {
    if (step.status === "waiting_review") {
      step.status = "completed";
      step.result = { ...(step.result || {}), decision: "continued after user review" };
    }
  }

  for (let index = run.nextStepIndex; index < run.steps.length; index++) {
    const step = run.steps[index];
    if (step.type === "review_checkpoint") {
      step.status = "waiting_review";
      run.nextStepIndex = index + 1;
      run.status = "waiting_review";
      step.result = { message: step.message || "Review the completed steps before continuing." };
      addLog(run, {
        stepIndex: index,
        stepTitle: step.title,
        status: "waiting_review",
        summary: "Paused for your review and approval to continue."
      });
      run.updatedAt = new Date().toISOString();
      return run;
    }

    const handler = handlers[step.type];
    if (typeof handler !== "function") {
      step.status = "failed";
      run.status = "failed";
      addLog(run, { stepIndex: index, stepTitle: step.title, status: "failed", summary: "This step has no registered handler." });
      run.finishedAt = new Date().toISOString();
      run.updatedAt = run.finishedAt;
      return run;
    }

    step.status = "running";
    run.updatedAt = new Date().toISOString();
    try {
      const result = await handler({ ...step });
      step.status = "completed";
      step.result = result && typeof result === "object" ? result : { summary: cleanText(result, 300) };
      run.nextStepIndex = index + 1;
      addLog(run, {
        stepIndex: index,
        stepTitle: step.title,
        status: "completed",
        summary: cleanText(step.result.summary || "Step completed.", 300)
      });
    } catch (error) {
      step.status = "failed";
      step.result = { error: cleanText(error?.message || "Step failed.", 200) };
      run.status = "failed";
      run.nextStepIndex = index;
      addLog(run, {
        stepIndex: index,
        stepTitle: step.title,
        status: "failed",
        summary: "Step failed. Review the error before creating a new run."
      });
      run.finishedAt = new Date().toISOString();
      run.updatedAt = run.finishedAt;
      return run;
    }
  }

  run.status = "completed";
  run.finishedAt = new Date().toISOString();
  run.updatedAt = run.finishedAt;
  return run;
}

export function cancelWorkflowRun(runInput) {
  const run = structuredClone(runInput);
  if (!["running", "waiting_review"].includes(run.status)) {
    throw new Error("Only an active workflow run can be stopped.");
  }
  for (const step of run.steps) {
    if (step.status === "pending" || step.status === "waiting_review") step.status = "skipped";
  }
  run.status = "cancelled";
  run.finishedAt = new Date().toISOString();
  run.updatedAt = run.finishedAt;
  addLog(run, {
    stepIndex: run.nextStepIndex,
    stepTitle: "Workflow stopped",
    status: "cancelled",
    summary: "You stopped this workflow. No later steps were run."
  });
  return run;
}

export const WORKFLOW_LIMITS = Object.freeze({
  workflows: MAX_WORKFLOWS,
  runs: MAX_RUNS,
  steps: MAX_STEPS
});
