import crypto from "node:crypto";

const MAX_GOAL_LENGTH = 1200;
const MAX_RUNS = 50;
const MAX_WORKERS_PER_RUN = 8;
const MAX_RESULT_TEXT = 2400;
const MAX_DETAIL_TEXT = 900;

const RUN_STATUSES = new Set(["ready", "running", "waiting_for_user", "blocked", "needs_review", "completed", "failed", "cancelled"]);
const STEP_STATUSES = new Set(["pending", "running", "waiting_for_user", "blocked", "needs_review", "completed", "failed", "skipped"]);
const RESULT_STATUSES = new Set(["completed", "waiting_for_user", "blocked", "failed"]);

const PRIVATE_CONTENT = /\b(?:api[_ -]?key|password|passcode|bearer\s+[a-z0-9._-]{8,}|secret\s*[:=]|private key|otp|one.?time password|medical|health|diagnos(?:is|ed)|medicine|medication|mental health|home address|street address|date of birth|race|ethnicity|religion|political affiliation|sexual orientation|sex life|criminal history|biometric)\b/i;
const EMAIL_CONTENT = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_CONTENT = /(?:\+?\d[\d\s().-]{8,}\d)/;
const DISALLOWED_GOAL = /\b(?:make|build|assemble)\s+(?:a\s+)?(?:bomb|explosive|weapon)|\b(?:steal credentials|credential theft|keylogger|ransomware|malware|bypass authentication|bypass a captcha|evade security|poison someone|hurt someone|self.?harm|suicide|pornography|sexual exploitation)\b/i;
const APPROVAL_REQUIRED = /\b(?:send (?:an? )?(?:email|message|sms)|publish(?: publicly)?|post publicly|share publicly|upload (?:it )?to youtube|delete (?:all )?(?:files|data|account)|remove (?:an? )?account|purchase|buy|make (?:a )?payment|pay (?:for|₹|\$)|transfer money|install (?:an? )?app|uninstall|change (?:critical )?security settings|grant (?:an? )?permission|revoke (?:an? )?permission)\b/i;

const WORKERS = Object.freeze([
  Object.freeze({ id: "security", name: "Security Worker", purpose: "Preflight the request and prevent unsupported or consequential actions from starting.", permissions: ["policy_preflight", "read_task_goal"], boundary: "Cannot elevate permissions, bypass authentication, disable safeguards or perform external actions." }),
  Object.freeze({ id: "research", name: "Research Worker", purpose: "Search configured public web sources and return source-linked findings.", permissions: ["configured_public_web_search", "read_public_https_sources"], boundary: "Requires the existing trusted search configuration; no login, CAPTCHA or access-control bypass." }),
  Object.freeze({ id: "coding", name: "Coding Worker", purpose: "Prepare a bounded implementation and test plan using local planning rules.", permissions: ["local_plan_generation"], boundary: "Plan-only in this phase; it cannot edit repositories, run shell commands or execute generated code." }),
  Object.freeze({ id: "android_operator", name: "Android Operator", purpose: "Prepare a supported, permission-bounded Android action plan.", permissions: ["local_android_plan_generation"], boundary: "Plan-only in this phase; actual device actions remain with the authorized Android execution flow." }),
  Object.freeze({ id: "media_creator", name: "Media Creation Worker", purpose: "Create and save a local editable storyboard draft.", permissions: ["create_local_media_storyboard"], boundary: "Creates a storyboard draft only; no image/video generation, export or publication is claimed." }),
  Object.freeze({ id: "memory", name: "Memory Worker", purpose: "Retrieve relevant user-approved memory and trusted knowledge.", permissions: ["read_user_approved_memory", "read_trusted_knowledge"], boundary: "Read-only; cannot create or silently update personal memory." }),
  Object.freeze({ id: "learning", name: "Learning Worker", purpose: "Preview relevant user-authored or user-reviewed learning context.", permissions: ["read_user_taught_lessons", "read_user_reviewed_knowledge"], boundary: "Read-only; does not save lessons, train model weights or automatically fact-check." }),
  Object.freeze({ id: "verification", name: "Verification Worker", purpose: "Check that each delegated worker produced the evidence required for its bounded assignment.", permissions: ["read_run_results", "check_artifact_metadata"], boundary: "Cannot turn missing evidence into success or override a blocked/failed worker." })
]);

const OPERATIONAL_WORKERS = new Set(WORKERS.map((item) => item.id).filter((id) => !["security", "verification"].includes(id)));

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function containsSensitiveInfo(value) {
  const text = String(value || "");
  const phoneCandidate = text.replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, " ");
  const phoneMatch = phoneCandidate.match(PHONE_CONTENT);
  const hasPhone = Boolean(phoneMatch && (phoneMatch[0].match(/\d/g) || []).length >= 10);
  return PRIVATE_CONTENT.test(text) || EMAIL_CONTENT.test(text) || hasPhone;
}

function assertSafeGoal(value) {
  if (typeof value !== "string" || value.normalize("NFKC").trim().length > MAX_GOAL_LENGTH) {
    throw new TypeError("Specialist goals must be 1,200 characters or fewer.");
  }
  const goal = cleanText(value, MAX_GOAL_LENGTH);
  if (!goal) throw new TypeError("Describe the goal before dispatching specialist workers.");
  if (containsSensitiveInfo(goal)) {
    throw new TypeError("Remove passwords, private contact details and sensitive personal information before dispatching this task.");
  }
  return goal;
}

function safeText(value, maxLength = MAX_DETAIL_TEXT) {
  const text = cleanText(value, maxLength);
  if (!text) return "";
  if (containsSensitiveInfo(text)) return "[redacted sensitive content]";
  return text;
}

function clone(value) {
  return structuredClone(value);
}

function safeDetails(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return null;
  if (typeof value === "string") return safeText(value, MAX_DETAIL_TEXT);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 8).map((item) => safeDetails(item, depth + 1));
  if (typeof value !== "object") return null;

  const output = {};
  for (const key of Object.keys(value).slice(0, 16)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key) || ["__proto__", "prototype", "constructor"].includes(key)) continue;
    if (/password|secret|token|credential|authorization|cookie|privatekey|api.?key/i.test(key)) continue;
    output[key] = safeDetails(value[key], depth + 1);
  }
  return output;
}

function safeEvidence(input) {
  if (!Array.isArray(input)) return [];
  const output = [];
  const seen = new Set();
  for (const item of input.slice(0, 10)) {
    const candidate = typeof item === "string" ? { url: item } : item;
    if (!candidate || typeof candidate !== "object") continue;
    try {
      const url = new URL(String(candidate.url || ""));
      if (url.protocol !== "https:" || url.username || url.password || seen.has(url.href)) continue;
      for (const key of [...url.searchParams.keys()]) {
        if (/token|secret|password|auth|signature|credential|key/i.test(key)) url.searchParams.delete(key);
      }
      seen.add(url.href);
      output.push({
        title: safeText(candidate.title || "Source", 160),
        url: url.href,
        ...(candidate.publishedAt ? { publishedAt: safeText(candidate.publishedAt, 60) } : {}),
        ...(candidate.retrievedAt ? { retrievedAt: safeText(candidate.retrievedAt, 60) } : {})
      });
    } catch {
      // Invalid evidence URLs are discarded rather than copied to history.
    }
  }
  return output;
}

function normalizeWorkerResult(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const status = RESULT_STATUSES.has(input.status) ? input.status : "failed";
  const summary = safeText(input.summary || "The worker returned no summary.", MAX_RESULT_TEXT);
  const result = {
    status,
    summary: summary || "The worker returned no summary.",
    details: safeDetails(input.details) || {},
    evidence: safeEvidence(input.evidence),
    artifact: null,
    verification: null
  };

  if (input.artifact && typeof input.artifact === "object") {
    const id = safeText(input.artifact.id, 100);
    const type = safeText(input.artifact.type, 60);
    const label = safeText(input.artifact.label, 160);
    if (id && type && label) result.artifact = { id, type, label };
  }

  if (input.verification && typeof input.verification === "object") {
    const checks = Array.isArray(input.verification.checks)
      ? input.verification.checks.slice(0, 10).map((item) => ({
          name: safeText(item?.name || "Verification check", 120),
          passed: item?.passed === true,
          evidence: safeText(item?.evidence || "", 180)
        }))
      : [];
    result.verification = {
      passed: input.verification.passed === true && checks.length > 0 && checks.every((item) => item.passed),
      checks
    };
  }

  return result;
}

export function getSpecialistWorkerCatalog() {
  return WORKERS.map((worker) => ({ ...worker, permissions: [...worker.permissions], status: "available" }));
}

export function inspectSpecialistRequest(goalInput) {
  const goal = assertSafeGoal(goalInput);
  if (DISALLOWED_GOAL.test(goal)) {
    return {
      status: "blocked",
      summary: "The requested operation is outside JARVIS's permitted specialist scope. No worker action was started.",
      details: { decision: "blocked", reason: "disallowed_request" }
    };
  }
  if (APPROVAL_REQUIRED.test(goal)) {
    return {
      status: "waiting_for_user",
      summary: "This request could change an external account or user data. Prepare a safer draft or plan first; no specialist action was started.",
      details: { decision: "approval_required", reason: "consequential_external_action" }
    };
  }
  return {
    status: "completed",
    summary: "Security preflight passed for bounded internal work. This does not grant additional device, account or external-action permissions.",
    details: { decision: "allow", reason: "bounded_internal_work_only" }
  };
}

function selectOperationalWorkers(goal) {
  const text = goal.toLocaleLowerCase();
  const selected = [];
  const rules = [
    ["research", /\b(research|search|google|internet|web|latest|current|source|sources|compare|investigate)\b/i],
    ["coding", /\b(code|coding|program|bug|debug|fix|implement|refactor|repository|github|software|build an app)\b/i],
    ["android_operator", /\b(android|tablet|device|app|open|launch|tap|click|screen|settings)\b/i],
    ["media_creator", /\b(video|animation|storyboard|media|thumbnail|voiceover|subtitle|reel|visuals|stick.?figure)\b/i],
    ["memory", /\b(memory|remember|recall|preference|preferences|saved facts|what do you know about me)\b/i],
    ["learning", /\b(learn|learning|teach|sikhao|lesson|knowledge|explain|understand|study|revise|revision)\b/i]
  ];
  for (const [id, pattern] of rules) if (pattern.test(text)) selected.push(id);
  return selected;
}

export function createSpecialistRun(goalInput, options = {}) {
  const goal = assertSafeGoal(goalInput);
  const requested = options.requestedWorkerIds;
  let operational;

  if (requested === undefined || requested === null) {
    operational = selectOperationalWorkers(goal);
  } else {
    if (!Array.isArray(requested) || requested.length < 1 || requested.length > 6) {
      throw new TypeError("Choose between one and six supported specialist workers.");
    }
    operational = [...new Set(requested)];
    if (operational.length !== requested.length || operational.some((id) => !OPERATIONAL_WORKERS.has(id))) {
      throw new TypeError("The requested specialist list contains an unknown or duplicate worker.");
    }
  }

  if (!operational.length) {
    throw new TypeError("No specialist matched this request. Add a clear task type such as research, coding, Android, media, memory or learning.");
  }

  const workerIds = ["security", ...WORKERS.map((item) => item.id).filter((id) => operational.includes(id)), "verification"];
  if (workerIds.length > MAX_WORKERS_PER_RUN) throw new TypeError("The specialist run exceeds its worker limit.");

  const now = cleanText(options.now, 80) || new Date().toISOString();
  return {
    version: 1,
    id: crypto.randomUUID(),
    goal,
    workerIds,
    status: "ready",
    summary: "Specialists are queued behind a security preflight. No work has started yet.",
    steps: workerIds.map((workerId) => ({ workerId, status: "pending", startedAt: null, finishedAt: null, result: null })),
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null
  };
}

export function normalizeSpecialistRun(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  let goal;
  try { goal = assertSafeGoal(input.goal); } catch { return null; }
  const workerIds = Array.isArray(input.workerIds) ? input.workerIds : [];
  if (workerIds.length < 3 || workerIds.length > MAX_WORKERS_PER_RUN ||
      workerIds.some((id, index, all) => typeof id !== "string" || !WORKERS.some((worker) => worker.id === id) || all.indexOf(id) !== index) ||
      workerIds[0] !== "security" || workerIds[workerIds.length - 1] !== "verification" ||
      workerIds.slice(1, -1).some((id) => !OPERATIONAL_WORKERS.has(id))) return null;

  const steps = Array.isArray(input.steps)
    ? input.steps.slice(0, MAX_WORKERS_PER_RUN).flatMap((step) => {
        if (!step || !workerIds.includes(step.workerId)) return [];
        const status = STEP_STATUSES.has(step.status) ? step.status : "pending";
        return [{
          workerId: step.workerId,
          status,
          startedAt: safeText(step.startedAt || "", 80) || null,
          finishedAt: safeText(step.finishedAt || "", 80) || null,
          result: normalizeWorkerResult(step.result)
        }];
      })
    : [];
  if (steps.length !== workerIds.length || steps.some((step, index) => step.workerId !== workerIds[index])) return null;

  return {
    version: 1,
    id: safeText(input.id, 80) || crypto.randomUUID(),
    goal,
    workerIds,
    status: RUN_STATUSES.has(input.status) ? input.status : "needs_review",
    summary: safeText(input.summary || "Specialist run restored from saved history.", 500),
    steps,
    createdAt: safeText(input.createdAt, 80) || new Date().toISOString(),
    updatedAt: safeText(input.updatedAt, 80) || new Date().toISOString(),
    startedAt: safeText(input.startedAt || "", 80) || null,
    finishedAt: safeText(input.finishedAt || "", 80) || null
  };
}

export function recoverInterruptedSpecialistRuns(runs, recoveredAt = new Date().toISOString()) {
  if (!Array.isArray(runs)) return [];
  return runs.map((input) => {
    const run = normalizeSpecialistRun(input);
    if (!run || run.status !== "running") return run || input;
    for (const step of run.steps) {
      if (step.status === "running") step.status = "needs_review";
      else if (step.status === "pending") step.status = "skipped";
    }
    run.status = "needs_review";
    run.summary = "The app restarted during this specialist run. Completed results were preserved; JARVIS will not replay unfinished workers automatically.";
    run.updatedAt = recoveredAt;
    run.finishedAt = recoveredAt;
    return run;
  });
}

async function checkpoint(run, onCheckpoint) {
  run.updatedAt = new Date().toISOString();
  if (typeof onCheckpoint === "function") await onCheckpoint(clone(run));
}

export async function executeSpecialistRun(runInput, adapters = {}, options = {}) {
  const run = normalizeSpecialistRun(runInput);
  if (!run) throw new TypeError("The specialist run is invalid.");
  if (run.status !== "ready") throw new Error("Only a newly prepared specialist run can be executed. Interrupted runs require review, not automatic replay.");

  const onCheckpoint = options.onCheckpoint;
  run.status = "running";
  run.startedAt = new Date().toISOString();
  run.summary = "Security preflight is running.";
  await checkpoint(run, onCheckpoint);

  for (const step of run.steps) {
    const adapter = adapters[step.workerId];
    step.status = "running";
    step.startedAt = new Date().toISOString();
    await checkpoint(run, onCheckpoint);

    if (typeof adapter !== "function") {
      step.status = "blocked";
      step.finishedAt = new Date().toISOString();
      step.result = normalizeWorkerResult({
        status: "blocked",
        summary: "This specialist has no registered execution adapter. No substitute action was attempted.",
        details: { reason: "worker_unavailable" }
      });
      run.status = "blocked";
      run.summary = "A required specialist capability is unavailable.";
      for (const pending of run.steps) if (pending.status === "pending") pending.status = "skipped";
      run.finishedAt = new Date().toISOString();
      await checkpoint(run, onCheckpoint);
      return run;
    }

    const completedResults = {};
    for (const completed of run.steps) {
      if (completed.status === "completed" && completed.result) completedResults[completed.workerId] = clone(completed.result);
    }

    try {
      const output = await adapter({
        runId: run.id,
        goal: run.goal,
        workerId: step.workerId,
        workerIds: [...run.workerIds],
        completedResults,
        completedSteps: run.steps.filter((item) => item.status === "completed").map(clone)
      });
      step.result = normalizeWorkerResult(output);
      if (!step.result) throw new Error("The specialist returned an invalid result.");
    } catch (error) {
      const code = typeof error?.code === "string" && /^[A-Z0-9_.-]{1,50}$/i.test(error.code) ? error.code : "WORKER_FAILED";
      step.status = "failed";
      step.finishedAt = new Date().toISOString();
      step.result = normalizeWorkerResult({
        status: "failed",
        summary: "The specialist could not complete its bounded operation. Review the task and correct the cause before retrying.",
        details: { failureCode: code }
      });
      run.status = "failed";
      run.summary = "A specialist failed. Later workers were not run.";
      for (const pending of run.steps) if (pending.status === "pending") pending.status = "skipped";
      run.finishedAt = new Date().toISOString();
      await checkpoint(run, onCheckpoint);
      return run;
    }

    step.status = step.result.status;
    step.finishedAt = new Date().toISOString();

    if (step.workerId === "security" && step.result.details?.decision !== "allow") {
      run.status = step.result.status === "waiting_for_user" ? "waiting_for_user" : "blocked";
      run.summary = step.result.summary;
      for (const pending of run.steps) if (pending.status === "pending") pending.status = "skipped";
      run.finishedAt = new Date().toISOString();
      await checkpoint(run, onCheckpoint);
      return run;
    }

    if (step.status !== "completed") {
      run.status = step.status === "waiting_for_user" ? "waiting_for_user" : "blocked";
      run.summary = step.result.summary;
      for (const pending of run.steps) if (pending.status === "pending") pending.status = "skipped";
      run.finishedAt = new Date().toISOString();
      await checkpoint(run, onCheckpoint);
      return run;
    }

    if (step.workerId === "verification") {
      const passed = step.result.verification?.passed === true;
      const allPriorWorkersPassed = run.steps
        .filter((item) => item.workerId !== "verification")
        .every((item) => item.status === "completed" && item.result?.summary);
      run.status = passed && allPriorWorkersPassed ? "completed" : "needs_review";
      run.summary = passed && allPriorWorkersPassed
        ? "All assigned specialists completed their bounded work and the verification worker found the required evidence."
        : "Specialist work finished, but the verification worker could not confirm every required result. Review the run before treating it as complete.";
      run.finishedAt = new Date().toISOString();
      await checkpoint(run, onCheckpoint);
      return run;
    }

    run.summary = "Completed " + step.workerId.replace(/_/g, " ") + ".";
    await checkpoint(run, onCheckpoint);
  }

  run.status = "needs_review";
  run.summary = "The verification step was not reached. The run cannot be marked complete.";
  run.finishedAt = new Date().toISOString();
  await checkpoint(run, onCheckpoint);
  return run;
}

export const SPECIALIST_WORKER_LIMITS = Object.freeze({
  goalLength: MAX_GOAL_LENGTH,
  runs: MAX_RUNS,
  workersPerRun: MAX_WORKERS_PER_RUN,
  operationalWorkers: [...OPERATIONAL_WORKERS],
  automaticRetry: false,
  automaticReplayAfterRestart: false,
  externalActionExecution: false,
  generatedCodeExecution: false
});
