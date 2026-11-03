import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approveRepairProposal,
  createDefaultAutoHealState,
  createRepairProposal,
  getAutoHealStatus,
  inspectWorkflowFailures,
  normalizeAutoHealState,
  rollbackRepairProposal,
  validateAutoHealConfig
} from "../services/auto-heal-engine.js";

function failedRun(overrides = {}) {
  return {
    id: "workflow-run-1",
    status: "failed",
    currentStepIndex: 0,
    steps: [{ title: "Prepare report", attempts: 1, status: "failed" }],
    failure: { code: "timeout", at: "2026-11-03T10:00:00.000Z", message: "raw provider detail must not be copied" },
    finishedAt: "2026-11-03T10:00:00.000Z",
    ...overrides
  };
}

test("default auto-heal state uses conservative bounded runtime settings", () => {
  const state = createDefaultAutoHealState();
  assert.equal(state.revision, 1);
  assert.equal(state.config.workflowStepTimeoutMs, 60_000);
  assert.equal(state.config.maxManualRetryAttempts, 3);
  assert.deepEqual(state.incidents, []);
  assert.deepEqual(state.proposals, []);
  const status = getAutoHealStatus(state);
  assert.equal(status.automaticRepair, false);
  assert.equal(status.automaticRetry, false);
  assert.equal(status.sourceModification, false);
  assert.equal(status.externalActions, false);
});

test("configuration validator rejects extra keys and out-of-range settings", () => {
  assert.equal(validateAutoHealConfig({
    workflowStepTimeoutMs: 75_000,
    maxManualRetryAttempts: 2
  }).passed, true);
  assert.equal(validateAutoHealConfig({
    workflowStepTimeoutMs: 180_000,
    maxManualRetryAttempts: 2
  }).passed, false);
  assert.equal(validateAutoHealConfig({
    workflowStepTimeoutMs: 75_000,
    maxManualRetryAttempts: 4
  }).passed, false);
  assert.equal(validateAutoHealConfig({
    workflowStepTimeoutMs: 75_000,
    maxManualRetryAttempts: 2,
    sourceFile: "server.js"
  }).passed, false);
});

test("inspection captures a sanitized failure incident once per workflow failure", () => {
  const state = createDefaultAutoHealState();
  const run = failedRun();
  const first = inspectWorkflowFailures([run], state);
  assert.equal(first.incidents.length, 1);
  assert.equal(first.incidents[0].failureCode, "timeout");
  assert.equal(first.incidents[0].message.includes("raw provider detail"), false);
  assert.equal(JSON.stringify(first).includes("raw provider detail"), false);
  const second = inspectWorkflowFailures([run], first);
  assert.equal(second.incidents.length, 1);
  assert.equal(second.incidents[0].id, first.incidents[0].id);
});

test("inspection ignores non-failed runs and normalizes unknown failure codes", () => {
  const state = createDefaultAutoHealState();
  const ignored = inspectWorkflowFailures([{ ...failedRun(), status: "completed" }], state);
  assert.equal(ignored.incidents.length, 0);
  const unknown = inspectWorkflowFailures([failedRun({
    id: "workflow-run-2",
    failure: { code: "unrecognized_code", at: "2026-11-03T10:01:00.000Z" }
  })], state);
  assert.equal(unknown.incidents[0].failureCode, "unknown");
  assert.match(unknown.incidents[0].message, /no supported automatic configuration proposal/i);
});

test("only workflow timeouts receive a tested bounded repair proposal", () => {
  const state = inspectWorkflowFailures([failedRun()], createDefaultAutoHealState());
  const incident = state.incidents[0];
  const proposalResult = createRepairProposal(state, incident.id);
  assert.equal(proposalResult.proposal.status, "tested");
  assert.equal(proposalResult.proposal.validation.passed, true);
  assert.equal(proposalResult.proposal.before.workflowStepTimeoutMs, 60_000);
  assert.equal(proposalResult.proposal.after.workflowStepTimeoutMs, 75_000);
  assert.equal(proposalResult.state.config.workflowStepTimeoutMs, 60_000);
  assert.equal(proposalResult.state.revision, 1);
  assert.equal(proposalResult.state.incidents[0].status, "proposal_ready");

  const rateLimited = inspectWorkflowFailures([failedRun({
    id: "workflow-run-rate-limit",
    failure: { code: "rate_limited", at: "2026-11-03T10:02:00.000Z" }
  })], createDefaultAutoHealState());
  assert.throws(() => createRepairProposal(rateLimited, rateLimited.incidents[0].id), /review and fix it manually/i);
});

test("repair proposal requires explicit approval and revision matching", () => {
  const incidentState = inspectWorkflowFailures([failedRun()], createDefaultAutoHealState());
  const { state, proposal } = createRepairProposal(incidentState, incidentState.incidents[0].id);
  assert.throws(() => approveRepairProposal(state, proposal.id, 1, false), /explicit confirmation/i);
  assert.throws(() => approveRepairProposal(state, proposal.id, 2, true), /state changed/i);
  assert.equal(state.config.workflowStepTimeoutMs, 60_000);
});

test("approved repair applies only the tested runtime setting and records history", () => {
  const incidentState = inspectWorkflowFailures([failedRun()], createDefaultAutoHealState());
  const { state, proposal } = createRepairProposal(incidentState, incidentState.incidents[0].id);
  const applied = approveRepairProposal(state, proposal.id, 1, true);
  assert.equal(applied.revision, 2);
  assert.equal(applied.config.workflowStepTimeoutMs, 75_000);
  assert.equal(applied.config.maxManualRetryAttempts, 3);
  assert.equal(applied.proposals[0].status, "applied");
  assert.equal(applied.proposals[0].appliedRevision, 2);
  assert.equal(applied.incidents[0].status, "mitigated");
  assert.equal(applied.history.length, 1);
  assert.equal(applied.history[0].action, "apply");
});

test("rollback restores the previous config only when the applied revision is unchanged", () => {
  const incidentState = inspectWorkflowFailures([failedRun()], createDefaultAutoHealState());
  const { state, proposal } = createRepairProposal(incidentState, incidentState.incidents[0].id);
  const applied = approveRepairProposal(state, proposal.id, 1, true);
  assert.throws(() => rollbackRepairProposal(applied, proposal.id, 2, false), /explicit confirmation/i);
  const rolledBack = rollbackRepairProposal(applied, proposal.id, 2, true);
  assert.equal(rolledBack.revision, 3);
  assert.equal(rolledBack.config.workflowStepTimeoutMs, 60_000);
  assert.equal(rolledBack.proposals[0].status, "rolled_back");
  assert.equal(rolledBack.incidents[0].status, "open");
  assert.equal(rolledBack.history.length, 2);
  assert.equal(rolledBack.history[1].action, "rollback");
});

test("rollback is refused after a later configuration revision or mismatched state", () => {
  const incidentState = inspectWorkflowFailures([failedRun()], createDefaultAutoHealState());
  const { state, proposal } = createRepairProposal(incidentState, incidentState.incidents[0].id);
  const applied = approveRepairProposal(state, proposal.id, 1, true);
  const changed = normalizeAutoHealState({
    ...applied,
    revision: applied.revision + 1,
    config: { ...applied.config, maxManualRetryAttempts: 2 }
  });
  assert.throws(() => rollbackRepairProposal(changed, proposal.id, changed.revision, true), /configuration changed/i);
});

test("timeout proposals stop at the configured upper bound", () => {
  const state = normalizeAutoHealState({
    ...createDefaultAutoHealState(),
    config: { workflowStepTimeoutMs: 120_000, maxManualRetryAttempts: 3 }
  });
  const withIncident = inspectWorkflowFailures([failedRun()], state);
  assert.throws(() => createRepairProposal(withIncident, withIncident.incidents[0].id), /upper limit/i);
});
