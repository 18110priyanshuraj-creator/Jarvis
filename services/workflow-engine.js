import crypto from "node:crypto";

export const WORKFLOW_STEP_TYPES = Object.freeze([
  "create_task",
  "save_memory",
  "search_knowledge",
  "draft_text",
  "review_checkpoint",
  "github_list_repositories",
  "google_drive_list_files",
  "telegram_get_bot_profile",
  "elevenlabs_get_account"
]);

const WORKFLOW_STATUSES = new Set(["draft", "approved", "paused"]);
const RUN_STATUSES = new Set(["queued", "running", "waiting_review", "paused", "completed", "failed", "cancelled"]);
const MAX_WORKFLOWS = 50;
const MAX_RUNS = 100;
const MAX_STEPS = 10;
export const WORKFLOW_STEP_TIMEOUT_MS = 60_000;
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

const WORKFLOW_FAILURES = Object.freeze({
  timeout: Object.freeze({
    code: "timeout",
    category: "transient",
    retryable: true,
    message: "The step timed out. Check whether it completed before retrying."
  }),
  rate_limited: Object.freeze({
    code: "rate_limited",
    category: "transient",
    retryable: true,
    message: "The connected service rate limit was reached. Wait, then retry manually."
  }),
  service_unavailable: Object.freeze({
    code: "service_unavailable",
    category: "transient",
    retryable: true,
    message: "The connected service is temporarily unavailable. Try again later."
  }),
  network_unavailable: Object.freeze({
    code: "network_unavailable",
    category: "transient",
    retryable: true,
    message: "The connection was unavailable. Check connectivity, then retry manually."
  }),
  storage_conflict: Object.freeze({
    code: "storage_conflict",
    category: "transient",
    retryable: true,
    message: "JARVIS could not save the latest checkpoint because data changed concurrently. Review the saved run, then retry manually."
  }),
  authentication_required: Object.freeze({
    code: "authentication_required",
    category: "action_required",
    retryable: false,
    message: "The connected service rejected its saved credential. Verify or reconnect it before continuing."
  }),
  permission_denied: Object.freeze({
    code: "permission_denied",
    category: "action_required",
    retryable: false,
    message: "The connected account lacks the required permission. Review its access before continuing."
  }),
  configuration_missing: Object.freeze({
    code: "configuration_missing",
    category: "action_required",
    retryable: false,
    message: "The integration is not configured or is disabled. Review Connections settings before continuing."
  }),
  endpoint_not_found: Object.freeze({
    code: "endpoint_not_found",
    category: "action_required",
    retryable: false,
    message: "The connected service endpoint was not found. Check the provider configuration."
  }),
  resource_limit: Object.freeze({
    code: "resource_limit",
    category: "action_required",
    retryable: false,
    message: "A workflow or local storage limit was reached. Review capacity before starting another run."
  }),
  invalid_request: Object.freeze({
    code: "invalid_request",
    category: "action_required",
    retryable: false,
    message: "The workflow step data is invalid or unsupported. Edit, validate and approve a new workflow version."
  }),
  handler_missing: Object.freeze({
    code: "handler_missing",
    category: "action_required",
    retryable: false,
    message: "This step has no registered handler. Update the workflow or restore the missing integration."
  }),
  unknown: Object.freeze({
    code: "unknown",
    category: "needs_review",
    retryable: false,
    message: "The failure could not be classified safely. Inspect the run and verify the underlying state before continuing."
  })
});

export function classifyWorkflowError(error) {
  const rawMessage = cleanText(error?.message || error || "", 500).toLocaleLowerCase();
  const name = cleanText(error?.name, 60);
  let code = Object.hasOwn(WORKFLOW_FAILURES, error?.code) ? error.code : "unknown";

  if (code !== "unknown") {
    // Trusted internal error codes take precedence over message heuristics.
  } else if (name === "TimeoutError" || name === "AbortError" ||
      /\b(?:timed? ?out|timeout|etimedout)\b/.test(rawMessage)) {
    code = "timeout";
  } else if (/\b(?:429|rate.?limit|too many requests)\b/.test(rawMessage)) {
    code = "rate_limited";
  } else if (/\b(?:401|unauthorized|credential|authentication|token was rejected|rejected the configured credential)\b/.test(rawMessage)) {
    code = "authentication_required";
  } else if (/\b(?:403|forbidden|permission denied|lacks permission|access denied)\b/.test(rawMessage)) {
    code = "permission_denied";
  } else if (/\b(?:not configured|disabled in jarvis|configuration missing|invalid configuration|token format is invalid)\b/.test(rawMessage)) {
    code = "configuration_missing";
  } else if (/\b(?:404|endpoint was not found|endpoint not found)\b/.test(rawMessage)) {
    code = "endpoint_not_found";
  } else if (/\b(?:limit reached|quota exceeded|capacity limit|too many records)\b/.test(rawMessage)) {
    code = "resource_limit";
  } else if (/\b(?:invalid|unsupported|malformed|unknown or unsupported)\b/.test(rawMessage)) {
    code = "invalid_request";
  } else if (/\b(?:kept changing during the save|concurrent|serialization conflict)\b/.test(rawMessage)) {
    code = "storage_conflict";
  } else if (/\b(?:temporarily unavailable|service unavailable|server error|5\d\d)\b/.test(rawMessage)) {
    code = "service_unavailable";
  } else if (/\b(?:could not connect|connection|network|fetch failed|econnreset|eai_again|temporary|temporarily)\b/.test(rawMessage)) {
    code = "network_unavailable";
  }

  const failure = WORKFLOW_FAILURES[code];
  return {
    code: failure.code,
    category: failure.category,
    retryable: failure.retryable,
    message: failure.message
  };
}

function makeWorkflowFailure(error, at = new Date().toISOString(), attempts = 0) {
  const classified = classifyWorkflowError(error);
  return {
    ...classified,
    at: timestamp(at),
    attempts: Number.isInteger(attempts) ? Math.max(0, Math.min(3, attempts)) : 0
  };
}

export function getWorkflowRecoverySummary(runInput) {
  const run = runInput && typeof runInput === "object" ? runInput : {};
  const index = Number.isInteger(run.currentStepIndex)
    ? run.currentStepIndex
    : Number.isInteger(run.nextStepIndex) ? run.nextStepIndex : -1;
  const step = Array.isArray(run.steps) && index >= 0 ? run.steps[index] : null;
  const attempts = Math.max(0, Number(step?.attempts) || 0);
  const storedFailure = run.failure || step?.result?.failure || null;

  if (run.status === "failed") {
    const classified = storedFailure && typeof storedFailure.code === "string" &&
      Object.hasOwn(WORKFLOW_FAILURES, storedFailure.code)
      ? WORKFLOW_FAILURES[storedFailure.code]
      : classifyWorkflowError(step?.result?.error || "");
    const retryable = classified.retryable === true && attempts < 3 && step?.status === "failed";
    return {
      runId: cleanText(run.id, 80),
      status: run.status,
      step: step ? { index, title: cleanText(step.title, MAX_TITLE), type: cleanText(step.type, 60) } : null,
      failure: {
        code: classified.code,
        category: classified.category,
        retryable: classified.retryable,
        message: classified.message,
        at: typeof storedFailure?.at === "string" ? storedFailure.at : ""
      },
      attempts,
      maxAttempts: 3,
      canRetry: retryable,
      canResume: false,
      requiresManualReview: !retryable,
      automaticRecovery: false,
      nextAction: retryable ? "retry_manually" : "review_or_fix",
      guidance: retryable
        ? classified.message + " Only the failed step will be retried after you explicitly confirm."
        : classified.message
    };
  }

  if (run.status === "paused") {
    return {
      runId: cleanText(run.id, 80),
      status: run.status,
      step: null,
      failure: null,
      attempts: 0,
      maxAttempts: 3,
      canRetry: false,
      canResume: true,
      requiresManualReview: true,
      automaticRecovery: false,
      nextAction: "resume_manually",
      guidance: "Review the last saved checkpoint and completed steps. Resume only after you explicitly confirm; interrupted actions are never replayed automatically."
    };
  }

  if (run.status === "waiting_review") {
    return {
      runId: cleanText(run.id, 80),
      status: run.status,
      step: null,
      failure: null,
      attempts: 0,
      maxAttempts: 3,
      canRetry: false,
      canResume: false,
      canContinue: true,
      requiresManualReview: true,
      automaticRecovery: false,
      nextAction: "continue_after_review",
      guidance: "Review the completed steps before choosing Continue. Later steps remain paused until you approve."
    };
  }

  return {
    runId: cleanText(run.id, 80),
    status: cleanText(run.status, 30) || "unknown",
    step: null,
    failure: null,
    attempts: 0,
    maxAttempts: 3,
    canRetry: false,
    canResume: false,
    requiresManualReview: false,
    automaticRecovery: false,
    nextAction: "none",
    guidance: "No recovery action is currently available for this run status."
  };
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
    if (content.length < 3 || !safeValue(content)) throw new TypeError("Memory step needs safe content between 3 and 500 characters; private or sensitive content is not allowed.");
    return { type, title, content, category };
  }
  if (type === "search_knowledge") {
    const query = cleanText(raw.query, 200);
    if (query.length < 3 || !safeValue(query)) throw new TypeError("Knowledge search needs a safe query of at least 3 characters.");
    return { type, title, query };
  }
  if (type === "draft_text") {
    const content = cleanText(raw.content, 2000);
    if (content.length < 10 || !safeValue(content)) throw new TypeError("Draft step needs safe text between 10 and 2,000 characters; private or sensitive content is not allowed.");
    return { type, title, content };
  }
  if (["github_list_repositories", "google_drive_list_files", "telegram_get_bot_profile", "elevenlabs_get_account"].includes(type)) {
    return { type, title };
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

export async function advanceWorkflowRun(runInput, handlers, options = {}) {
  const run = structuredClone(runInput);
  if (run.status !== "running") throw new Error("Only a running workflow can advance.");
  if (!handlers || typeof handlers !== "object") throw new TypeError("Workflow handlers are required.");

  const onCheckpoint = typeof options.onCheckpoint === "function" ? options.onCheckpoint : async () => {};
  const shouldPause = typeof options.shouldPause === "function" ? options.shouldPause : () => false;
  const shouldCancel = typeof options.shouldCancel === "function" ? options.shouldCancel : () => false;
  const requestedTimeout = Number(options.stepTimeoutMs);
  const stepTimeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(100, Math.min(120_000, Math.floor(requestedTimeout)))
    : WORKFLOW_STEP_TIMEOUT_MS;

  async function checkpoint() {
    run.updatedAt = new Date().toISOString();
    await onCheckpoint(structuredClone(run));
  }

  function finishCancelled(index) {
    for (const step of run.steps) {
      if (["pending", "waiting_review"].includes(step.status)) step.status = "skipped";
    }
    run.status = "cancelled";
    run.finishedAt = new Date().toISOString();
    addLog(run, {
      stepIndex: Number.isInteger(index) ? index : run.nextStepIndex,
      stepTitle: "Workflow stopped",
      status: "cancelled",
      summary: "The workflow was stopped at a safe step boundary. No later steps were run."
    });
  }

  for (const step of run.steps) {
    if (step.status === "waiting_review") {
      step.status = "completed";
      step.result = { ...(step.result || {}), decision: "continued after user review" };
    }
  }

  for (let index = run.nextStepIndex; index < run.steps.length; index++) {
    const step = run.steps[index];

    if (shouldCancel()) {
      finishCancelled(index);
      await checkpoint();
      return run;
    }

    if (shouldPause()) {
      run.status = "paused";
      run.pauseRequestedAt = run.pauseRequestedAt || new Date().toISOString();
      addLog(run, {
        stepIndex: index,
        stepTitle: step.title,
        status: "paused",
        summary: "Paused at a safe checkpoint. Resume only when you are ready."
      });
      await checkpoint();
      return run;
    }

    if (step.type === "review_checkpoint") {
      step.status = "waiting_review";
      run.nextStepIndex = index + 1;
      run.currentStepIndex = null;
      run.status = "waiting_review";
      step.result = { message: step.message || "Review the completed steps before continuing." };
      addLog(run, {
        stepIndex: index,
        stepTitle: step.title,
        status: "waiting_review",
        summary: "Paused for your review and approval to continue."
      });
      await checkpoint();
      return run;
    }

    const handler = handlers[step.type];
    if (typeof handler !== "function") {
      step.status = "failed";
      run.status = "failed";
      run.currentStepIndex = index;
      const failure = makeWorkflowFailure(Object.assign(new Error("This step has no registered handler."), { code: "handler_missing" }), new Date().toISOString(), 0);
      step.result = { error: failure.message, failure };
      run.failure = failure;
      addLog(run, { stepIndex: index, stepTitle: step.title, status: "failed", summary: failure.message });
      run.finishedAt = new Date().toISOString();
      await checkpoint();
      return run;
    }

    const executionKey = run.id + ":" + index;
    step.attempts = Math.max(0, Number(step.attempts) || 0) + 1;
    if (step.attempts > 3) {
      step.status = "failed";
      run.status = "failed";
      run.currentStepIndex = index;
      const failure = makeWorkflowFailure(Object.assign(new Error("The step reached the maximum of three attempts."), { code: "resource_limit" }), new Date().toISOString(), step.attempts);
      step.result = { error: failure.message, failure };
      run.failure = failure;
      addLog(run, {
        stepIndex: index,
        stepTitle: step.title,
        status: "failed",
        summary: failure.message
      });
      run.finishedAt = new Date().toISOString();
      await checkpoint();
      return run;
    }
    step.status = "running";
    step.executionKey = executionKey;
    run.currentStepIndex = index;
    run.nextStepIndex = index;
    await checkpoint();

    try {
      let timeout;
      const handlerPromise = Promise.resolve().then(() =>
        handler({ ...step, executionKey, runId: run.id, stepIndex: index })
      );
      const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Workflow step timed out after " + stepTimeoutMs + " ms."));
        }, stepTimeoutMs);
      });
      let result;
      try {
        result = await Promise.race([handlerPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeout);
      }
      step.status = "completed";
      step.result = result && typeof result === "object" ? result : { summary: cleanText(result, 300) };
      run.nextStepIndex = index + 1;
      run.currentStepIndex = null;
      addLog(run, {
        stepIndex: index,
        stepTitle: step.title,
        status: "completed",
        summary: cleanText(step.result.summary || "Step completed.", 300)
      });
      await checkpoint();
    } catch (error) {
      const failure = makeWorkflowFailure(error, new Date().toISOString(), step.attempts);
      step.status = "failed";
      step.result = { error: failure.message, failure };
      run.failure = failure;
      run.status = "failed";
      run.nextStepIndex = index;
      run.currentStepIndex = index;
      addLog(run, {
        stepIndex: index,
        stepTitle: step.title,
        status: "failed",
        summary: failure.message
      });
      run.finishedAt = new Date().toISOString();
      await checkpoint();
      return run;
    }
  }

  run.status = "completed";
  run.currentStepIndex = null;
  run.finishedAt = new Date().toISOString();
  await checkpoint();
  return run;
}

export function pauseWorkflowRun(runInput) {
  const run = structuredClone(runInput);
  if (!["queued", "running"].includes(run.status)) throw new Error("Only a queued or running workflow can be paused.");
  run.status = "paused";
  run.pauseRequestedAt = new Date().toISOString();
  run.updatedAt = run.pauseRequestedAt;
  return run;
}

export function resumeWorkflowRun(runInput) {
  const run = structuredClone(runInput);
  if (run.status !== "paused") throw new Error("Only a paused workflow run can be resumed.");
  run.status = "running";
  run.pauseRequestedAt = "";
  run.updatedAt = new Date().toISOString();
  run.finishedAt = "";
  addLog(run, {
    stepIndex: run.nextStepIndex,
    stepTitle: "Workflow resumed",
    status: "running",
    summary: "Execution resumed from the last durable checkpoint."
  });
  return run;
}

export function retryWorkflowRun(runInput) {
  const run = structuredClone(runInput);
  if (run.status !== "failed") throw new Error("Only a failed workflow run can be retried.");
  const index = Number.isInteger(run.currentStepIndex)
    ? run.currentStepIndex
    : Number.isInteger(run.nextStepIndex) ? run.nextStepIndex : -1;
  const step = run.steps?.[index];
  if (!step || step.status !== "failed") throw new Error("The failed step could not be identified safely.");
  if ((Number(step.attempts) || 0) >= 3) throw new Error("This step reached the maximum of three attempts.");
  const storedFailure = run.failure || step.result?.failure;
  const classification = storedFailure && Object.hasOwn(WORKFLOW_FAILURES, storedFailure.code)
    ? WORKFLOW_FAILURES[storedFailure.code]
    : classifyWorkflowError(step.result?.error || "");
  if (!classification.retryable) {
    throw new Error("This failure is not safe to retry. Fix the underlying cause and create a new run.");
  }
  step.lastFailure = step.result || null;
  step.result = null;
  step.status = "pending";
  run.status = "running";
  run.nextStepIndex = index;
  run.currentStepIndex = null;
  run.failure = null;
  run.finishedAt = "";
  run.updatedAt = new Date().toISOString();
  addLog(run, {
    stepIndex: index,
    stepTitle: step.title,
    status: "running",
    summary: "A manual retry was approved. The runner will replay the same idempotency key for this step."
  });
  return run;
}

export function recoverInterruptedWorkflowRuns(runs, recoveredAt = new Date().toISOString()) {
  if (!Array.isArray(runs)) return [];
  return runs.map((input) => {
    const run = structuredClone(input);
    if (!["queued", "running"].includes(run.status)) return run;

    const index = Number.isInteger(run.currentStepIndex)
      ? run.currentStepIndex
      : Number.isInteger(run.nextStepIndex) ? run.nextStepIndex : 0;
    const step = run.steps?.[index];
    if (step?.status === "running") {
      // The previous process may have stopped after the effect but before its
      // completion checkpoint. Stable execution keys let write handlers replay
      // the stored result instead of repeating a committed local effect.
      step.status = "pending";
      step.recoveredFromInterrupted = true;
    }

    run.status = "paused";
    run.nextStepIndex = Math.max(0, Math.min(index, run.steps?.length || 0));
    run.currentStepIndex = null;
    run.recovery = {
      reason: "process_restart",
      recoveredAt,
      resumeFromStep: run.nextStepIndex,
      requiresManualResume: true
    };
    run.updatedAt = recoveredAt;
    addLog(run, {
      stepIndex: run.nextStepIndex,
      stepTitle: "Recovered after restart",
      status: "paused",
      summary: "The previous process stopped during execution. JARVIS preserved the last checkpoint and paused for manual resume."
    });
    return run;
  });
}

export function cancelWorkflowRun(runInput) {
  const run = structuredClone(runInput);
  if (!["queued", "running", "waiting_review", "paused"].includes(run.status)) {
    throw new Error("Only an active workflow run can be stopped.");
  }
  for (const step of run.steps) {
    if (["pending", "waiting_review"].includes(step.status)) step.status = "skipped";
  }
  run.status = "cancelled";
  run.finishedAt = new Date().toISOString();
  run.updatedAt = run.finishedAt;
  run.currentStepIndex = null;
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
