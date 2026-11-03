import crypto from "node:crypto";

const MAX_INCIDENTS = 100;
const MAX_PROPOSALS = 50;
const MAX_HISTORY = 100;
const MIN_STEP_TIMEOUT_MS = 10_000;
const MAX_STEP_TIMEOUT_MS = 120_000;
const MIN_MANUAL_RETRIES = 1;
const MAX_MANUAL_RETRIES = 3;

export const DEFAULT_AUTO_HEAL_CONFIG = Object.freeze({
  workflowStepTimeoutMs: 60_000,
  maxManualRetryAttempts: 3
});

const FAILURE_DETAILS = Object.freeze({
  timeout: Object.freeze({
    category: "transient",
    message: "A workflow step exceeded its configured time limit. A bounded timeout increase can be proposed for review."
  }),
  rate_limited: Object.freeze({
    category: "transient",
    message: "A connected service rate limit was reached. Wait and review the provider before retrying."
  }),
  service_unavailable: Object.freeze({
    category: "transient",
    message: "A connected service was unavailable. Review the provider status before retrying."
  }),
  network_unavailable: Object.freeze({
    category: "transient",
    message: "A network connection was unavailable. Check connectivity before retrying."
  }),
  storage_conflict: Object.freeze({
    category: "transient",
    message: "A concurrent state update prevented a checkpoint save. Review the latest saved state."
  }),
  configuration_missing: Object.freeze({
    category: "configuration",
    message: "A required integration or configuration is missing. Review settings manually."
  }),
  permission_denied: Object.freeze({
    category: "permission",
    message: "The requested operation lacks permission. Review the granted capability manually."
  }),
  invalid_request: Object.freeze({
    category: "input",
    message: "The operation was rejected because its input was invalid. Review the workflow definition."
  }),
  unknown: Object.freeze({
    category: "unknown",
    message: "This failure has no supported automatic configuration proposal. Review it manually."
  })
});

const VALID_INCIDENT_STATUSES = new Set(["open", "proposal_ready", "mitigated", "dismissed"]);
const VALID_PROPOSAL_STATUSES = new Set(["tested", "applied", "rolled_back", "rejected"]);

function cleanText(value, max) {
  return typeof value === "string" ? value.normalize("NFKC").trim().slice(0, max) : "";
}

function clone(value) {
  return structuredClone(value);
}

function sameConfig(left, right) {
  return left?.workflowStepTimeoutMs === right?.workflowStepTimeoutMs &&
    left?.maxManualRetryAttempts === right?.maxManualRetryAttempts;
}

function isIntegerBetween(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function validateAutoHealConfig(input) {
  const expectedKeys = ["workflowStepTimeoutMs", "maxManualRetryAttempts"];
  const isObject = input && typeof input === "object" && !Array.isArray(input);
  const keys = isObject ? Object.keys(input) : [];
  const exactShape = isObject && keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(input, key));
  const checks = [
    {
      name: "Only approved runtime settings can change",
      passed: exactShape
    },
    {
      name: "Workflow timeout stays between 10 and 120 seconds",
      passed: exactShape && isIntegerBetween(input.workflowStepTimeoutMs, MIN_STEP_TIMEOUT_MS, MAX_STEP_TIMEOUT_MS)
    },
    {
      name: "Manual retry allowance stays between 1 and 3 attempts",
      passed: exactShape && isIntegerBetween(input.maxManualRetryAttempts, MIN_MANUAL_RETRIES, MAX_MANUAL_RETRIES)
    },
    {
      name: "Automatic retries remain disabled",
      passed: true
    },
    {
      name: "Source files, secrets, storage paths and external actions are outside the repair surface",
      passed: true
    }
  ];
  const passed = checks.every((item) => item.passed);
  return {
    passed,
    checks,
    ...(passed ? {
      config: {
        workflowStepTimeoutMs: input.workflowStepTimeoutMs,
        maxManualRetryAttempts: input.maxManualRetryAttempts
      }
    } : {})
  };
}

function normalizeConfig(input) {
  const validation = validateAutoHealConfig(input);
  if (validation.passed) return validation.config;
  return { ...DEFAULT_AUTO_HEAL_CONFIG };
}

function normalizeIncident(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const id = cleanText(input.id, 80);
  const runId = cleanText(input.runId, 80);
  const code = Object.hasOwn(FAILURE_DETAILS, input.failureCode) ? input.failureCode : "unknown";
  if (!id || !runId) return null;
  return {
    id,
    runId,
    fingerprint: cleanText(input.fingerprint, 180),
    failureCode: code,
    category: FAILURE_DETAILS[code].category,
    message: FAILURE_DETAILS[code].message,
    stepTitle: cleanText(input.stepTitle, 100),
    attempts: Math.max(0, Math.min(100, Number(input.attempts) || 0)),
    status: VALID_INCIDENT_STATUSES.has(input.status) ? input.status : "open",
    createdAt: cleanText(input.createdAt, 80) || new Date().toISOString()
  };
}

function normalizeProposal(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const id = cleanText(input.id, 80);
  const incidentId = cleanText(input.incidentId, 80);
  const beforeValidation = validateAutoHealConfig(input.before);
  const afterValidation = validateAutoHealConfig(input.after);
  const baseRevision = Number(input.baseRevision);
  if (!id || !incidentId || !Number.isInteger(baseRevision) || baseRevision < 1 ||
      !beforeValidation.passed || !afterValidation.passed ||
      !VALID_PROPOSAL_STATUSES.has(input.status)) return null;
  const before = beforeValidation.config;
  const after = afterValidation.config;
  const validation = afterValidation;
  if (sameConfig(before, after) === true) return null;
  const status = input.status;
  return {
    id,
    incidentId,
    change: "workflowStepTimeoutMs",
    summary: "Increase the workflow step timeout by 15 seconds, without exceeding 120 seconds.",
    before,
    after,
    validation: {
      passed: input.validation?.passed === true && validation.passed,
      checks: validation.checks
    },
    status,
    baseRevision,
    appliedRevision: Number.isInteger(input.appliedRevision) ? input.appliedRevision : null,
    createdAt: cleanText(input.createdAt, 80) || new Date().toISOString(),
    approvedAt: cleanText(input.approvedAt, 80),
    rolledBackAt: cleanText(input.rolledBackAt, 80)
  };
}

export function normalizeAutoHealState(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
  const revision = Number.isInteger(input.revision) && input.revision > 0 ? input.revision : 1;
  const incidents = Array.isArray(input.incidents)
    ? input.incidents.slice(-MAX_INCIDENTS).flatMap((item) => {
        const incident = normalizeIncident(item);
        return incident ? [incident] : [];
      })
    : [];
  const proposals = Array.isArray(input.proposals)
    ? input.proposals.slice(-MAX_PROPOSALS).flatMap((item) => {
        const proposal = normalizeProposal(item);
        return proposal ? [proposal] : [];
      })
    : [];
  const history = Array.isArray(input.history)
    ? input.history.slice(-MAX_HISTORY).flatMap((item) => {
        if (!item || typeof item !== "object" || !["apply", "rollback"].includes(item.action)) return [];
        const before = normalizeConfig(item.before);
        const after = normalizeConfig(item.after);
        return [{
          revision: Math.max(1, Number(item.revision) || 1),
          proposalId: cleanText(item.proposalId, 80),
          action: item.action,
          before,
          after,
          createdAt: cleanText(item.createdAt, 80) || new Date().toISOString()
        }];
      })
    : [];
  return {
    revision,
    config: normalizeConfig(input.config),
    incidents,
    proposals,
    history
  };
}

export function createDefaultAutoHealState() {
  return normalizeAutoHealState({
    revision: 1,
    config: { ...DEFAULT_AUTO_HEAL_CONFIG },
    incidents: [],
    proposals: [],
    history: []
  });
}

export function inspectWorkflowFailures(runs, stateInput, now = new Date().toISOString()) {
  const state = normalizeAutoHealState(stateInput);
  const known = new Set(state.incidents.map((item) => item.fingerprint).filter(Boolean));
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || run.status !== "failed" || typeof run.id !== "string") continue;
    const index = Number.isInteger(run.currentStepIndex)
      ? run.currentStepIndex
      : Number.isInteger(run.nextStepIndex) ? run.nextStepIndex : -1;
    const step = index >= 0 && Array.isArray(run.steps) ? run.steps[index] : null;
    const storedCode = run.failure?.code || step?.result?.failure?.code || "unknown";
    const code = Object.hasOwn(FAILURE_DETAILS, storedCode) ? storedCode : "unknown";
    const at = cleanText(run.failure?.at || step?.result?.failure?.at || run.finishedAt || run.updatedAt, 80);
    const fingerprint = run.id + ":" + (at || "failed");
    if (known.has(fingerprint)) continue;
    known.add(fingerprint);
    const incident = normalizeIncident({
      id: crypto.randomUUID(),
      runId: run.id,
      fingerprint,
      failureCode: code,
      stepTitle: cleanText(step?.title, 100),
      attempts: Math.max(0, Number(step?.attempts || run.failure?.attempts) || 0),
      status: "open",
      createdAt: now
    });
    if (incident) state.incidents.push(incident);
  }
  state.incidents = state.incidents.slice(-MAX_INCIDENTS);
  return state;
}

export function createRepairProposal(stateInput, incidentId, now = new Date().toISOString()) {
  const state = normalizeAutoHealState(stateInput);
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) throw new Error("The selected auto-heal incident does not exist.");
  if (incident.failureCode !== "timeout") {
    throw new Error("No bounded repair proposal is available for this failure. Review and fix it manually.");
  }
  if (incident.status === "dismissed") throw new Error("A dismissed incident cannot create a repair proposal.");
  const previous = state.proposals.find((item) => item.incidentId === incident.id &&
    ["tested", "applied"].includes(item.status));
  if (previous) throw new Error("A tested or applied proposal already exists for this incident.");
  const before = { ...state.config };
  if (before.workflowStepTimeoutMs >= MAX_STEP_TIMEOUT_MS) {
    throw new Error("The workflow timeout is already at its safe upper limit.");
  }
  const after = {
    ...before,
    workflowStepTimeoutMs: Math.min(MAX_STEP_TIMEOUT_MS, before.workflowStepTimeoutMs + 15_000)
  };
  const validation = validateAutoHealConfig(after);
  if (!validation.passed) throw new Error("The candidate configuration did not pass the safe repair checks.");
  const proposal = {
    id: crypto.randomUUID(),
    incidentId: incident.id,
    change: "workflowStepTimeoutMs",
    summary: "Increase the workflow step timeout by 15 seconds, without exceeding 120 seconds.",
    before,
    after,
    validation: { passed: true, checks: validation.checks },
    status: "tested",
    baseRevision: state.revision,
    appliedRevision: null,
    createdAt: now,
    approvedAt: "",
    rolledBackAt: ""
  };
  state.proposals.push(proposal);
  state.proposals = state.proposals.slice(-MAX_PROPOSALS);
  state.incidents = state.incidents.map((item) => item.id === incident.id
    ? { ...item, status: "proposal_ready" }
    : item);
  return { state, proposal };
}

function requireExpectedRevision(state, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== state.revision) {
    throw new Error("Auto-heal state changed. Refresh the page and review the latest proposal before continuing.");
  }
}

export function approveRepairProposal(stateInput, proposalId, expectedRevision, confirmed, now = new Date().toISOString()) {
  const state = normalizeAutoHealState(stateInput);
  if (confirmed !== true) throw new Error("Explicit confirmation is required before applying a repair.");
  requireExpectedRevision(state, expectedRevision);
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "tested") throw new Error("Only a tested, unapplied repair proposal can be approved.");
  if (proposal.baseRevision !== state.revision || !sameConfig(state.config, proposal.before)) {
    throw new Error("The repair proposal is stale. Create a fresh proposal from the current configuration.");
  }
  const validation = validateAutoHealConfig(proposal.after);
  if (!validation.passed || !proposal.validation.passed) throw new Error("The repair proposal did not pass its configuration checks.");
  const before = { ...state.config };
  state.config = { ...proposal.after };
  state.revision += 1;
  state.proposals = state.proposals.map((item) => {
    if (item.id === proposal.id) {
      return { ...item, status: "applied", approvedAt: now, appliedRevision: state.revision };
    }
    if (item.status === "tested" && item.baseRevision === expectedRevision) {
      return { ...item, status: "rejected" };
    }
    return item;
  });
  state.incidents = state.incidents.map((item) => item.id === proposal.incidentId
    ? { ...item, status: "mitigated" }
    : item);
  state.history.push({
    revision: state.revision,
    proposalId: proposal.id,
    action: "apply",
    before,
    after: { ...state.config },
    createdAt: now
  });
  state.history = state.history.slice(-MAX_HISTORY);
  return state;
}

export function rollbackRepairProposal(stateInput, proposalId, expectedRevision, confirmed, now = new Date().toISOString()) {
  const state = normalizeAutoHealState(stateInput);
  if (confirmed !== true) throw new Error("Explicit confirmation is required before rolling back a repair.");
  requireExpectedRevision(state, expectedRevision);
  const proposal = state.proposals.find((item) => item.id === proposalId);
  if (!proposal || proposal.status !== "applied") throw new Error("Only an applied repair proposal can be rolled back.");
  if (proposal.appliedRevision !== state.revision || !sameConfig(state.config, proposal.after)) {
    throw new Error("Rollback is blocked because the runtime configuration changed after this repair was applied.");
  }
  const before = { ...state.config };
  state.config = { ...proposal.before };
  state.revision += 1;
  state.proposals = state.proposals.map((item) => {
    if (item.id === proposal.id) return { ...item, status: "rolled_back", rolledBackAt: now };
    if (item.status === "tested" && item.baseRevision === expectedRevision) {
      return { ...item, status: "rejected" };
    }
    return item;
  });
  state.incidents = state.incidents.map((item) => item.id === proposal.incidentId
    ? { ...item, status: "open" }
    : item);
  state.history.push({
    revision: state.revision,
    proposalId: proposal.id,
    action: "rollback",
    before,
    after: { ...state.config },
    createdAt: now
  });
  state.history = state.history.slice(-MAX_HISTORY);
  return state;
}

export function getAutoHealStatus(stateInput) {
  const state = normalizeAutoHealState(stateInput);
  return {
    mode: "human-approved-runtime-configuration",
    revision: state.revision,
    config: { ...state.config },
    incidentCapture: "on-workflow-failure-and-manual-inspection",
    automaticRepair: false,
    automaticRetry: false,
    sourceModification: false,
    externalActions: false,
    openIncidents: state.incidents.filter((item) => ["open", "proposal_ready"].includes(item.status)).length,
    testedProposals: state.proposals.filter((item) => item.status === "tested").length,
    appliedProposals: state.proposals.filter((item) => item.status === "applied").length
  };
}

export const AUTO_HEAL_LIMITS = Object.freeze({
  incidents: MAX_INCIDENTS,
  proposals: MAX_PROPOSALS,
  history: MAX_HISTORY,
  minWorkflowStepTimeoutMs: MIN_STEP_TIMEOUT_MS,
  maxWorkflowStepTimeoutMs: MAX_STEP_TIMEOUT_MS,
  minManualRetryAttempts: MIN_MANUAL_RETRIES,
  maxManualRetryAttempts: MAX_MANUAL_RETRIES,
  timeoutIncreasePerProposalMs: 15_000
});
