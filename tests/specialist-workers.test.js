import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSpecialistRun,
  executeSpecialistRun,
  getSpecialistWorkerCatalog,
  inspectSpecialistRequest,
  normalizeSpecialistRun,
  recoverInterruptedSpecialistRuns
} from "../services/specialist-workers.js";

function safeAdapters(overrides = {}) {
  return {
    security: async () => ({ status: "completed", summary: "Policy preflight passed.", details: { decision: "allow" } }),
    media_creator: async () => ({ status: "completed", summary: "A local storyboard draft was saved.", artifact: { type: "media_storyboard", id: "media-1", label: "Gravity explainer" } }),
    verification: async ({ completedSteps }) => {
      const checks = completedSteps.filter((item) => item.workerId !== "security").map((item) => ({
        name: item.workerId + " produced a bounded result",
        passed: item.status === "completed" && Boolean(item.result?.summary),
        evidence: item.result?.artifact?.id || "result summary recorded"
      }));
      return { status: "completed", summary: "Every assigned specialist result was checked.", verification: { passed: checks.length > 0 && checks.every((item) => item.passed), checks } };
    },
    ...overrides
  };
}

test("catalog exposes the eight internal workers and their explicit boundaries", () => {
  const workers = getSpecialistWorkerCatalog();
  assert.equal(workers.length, 8);
  assert.deepEqual(workers.map((item) => item.id), ["security", "research", "coding", "android_operator", "media_creator", "memory", "learning", "verification"]);
  assert.ok(workers.every((item) => item.permissions.length > 0));
  assert.ok(workers.find((item) => item.id === "coding").boundary.includes("Plan-only"));
  assert.ok(workers.find((item) => item.id === "android_operator").boundary.includes("Plan-only"));
});

test("media goal is assigned to security, media creation and verification in one ordered run", () => {
  const run = createSpecialistRun("Create an educational stick-figure animation storyboard about gravity.");
  assert.deepEqual(run.workerIds, ["security", "media_creator", "verification"]);
  assert.equal(run.status, "ready");
  assert.deepEqual(run.steps.map((item) => item.status), ["pending", "pending", "pending"]);
});

test("explicit specialist selection rejects unknown and duplicate workers", () => {
  assert.throws(() => createSpecialistRun("Create a coding plan.", { requestedWorkerIds: ["coding", "admin"] }), /unknown or duplicate/i);
  assert.throws(() => createSpecialistRun("Create a coding plan.", { requestedWorkerIds: ["coding", "coding"] }), /unknown or duplicate/i);
  assert.throws(() => createSpecialistRun("Create a coding plan.", { requestedWorkerIds: [] }), /one and six/i);
});

test("empty and sensitive goals are rejected before persistent dispatch", () => {
  assert.throws(() => createSpecialistRun(" "), /describe the goal/i);
  assert.throws(() => createSpecialistRun("Use my password: secret123 to log in and research this."), /remove passwords/i);
  assert.throws(() => createSpecialistRun("Send this to learner@example.com"), /private contact details/i);
  assert.throws(() => createSpecialistRun("Research this task for contact 9876543210."), /private contact details/i);
  const dated = createSpecialistRun("Research this task by 2026-11-03.");
  assert.equal(dated.goal, "Research this task by 2026-11-03.");
  assert.ok(Number.isFinite(Date.parse(dated.createdAt)));
});

test("security preflight blocks unsafe requests and pauses consequential actions", () => {
  assert.equal(inspectSpecialistRequest("Bypass authentication and access a private account.").status, "blocked");
  const approval = inspectSpecialistRequest("Publish this video publicly on YouTube.");
  assert.equal(approval.status, "waiting_for_user");
  assert.equal(approval.details.decision, "approval_required");
  assert.equal(inspectSpecialistRequest("Create a local educational storyboard about gravity.").details.decision, "allow");
});

test("a specialist run executes sequentially and cannot complete without verified evidence", async () => {
  const run = createSpecialistRun("Create a video storyboard about gravity.");
  const order = [];
  const checkpoints = [];
  const result = await executeSpecialistRun(run, safeAdapters({
    security: async () => { order.push("security"); return { status: "completed", summary: "Policy passed.", details: { decision: "allow" } }; },
    media_creator: async () => { order.push("media_creator"); return { status: "completed", summary: "Draft saved.", artifact: { type: "media_storyboard", id: "media-1", label: "Storyboard" } }; },
    verification: async ({ completedSteps }) => {
      order.push("verification");
      const check = completedSteps.some((item) => item.workerId === "media_creator" && item.result?.artifact?.id === "media-1");
      return { status: "completed", summary: "Artifact metadata checked.", verification: { passed: check, checks: [{ name: "Storyboard artifact exists", passed: check, evidence: "media-1" }] } };
    }
  }), { onCheckpoint: (snapshot) => checkpoints.push(snapshot.status + ":" + snapshot.steps.filter((item) => item.status === "completed").length) });

  assert.equal(result.status, "completed");
  assert.deepEqual(order, ["security", "media_creator", "verification"]);
  assert.ok(checkpoints.length >= 7);
  assert.equal(result.steps[2].result.verification.passed, true);
});

test("a security approval gate prevents all specialist side effects", async () => {
  const run = createSpecialistRun("Upload this video to YouTube and publish it publicly.");
  let mediaInvoked = false;
  const result = await executeSpecialistRun(run, safeAdapters({
    security: async () => inspectSpecialistRequest(run.goal),
    media_creator: async () => { mediaInvoked = true; return { status: "completed", summary: "Not expected." }; }
  }));
  assert.equal(result.status, "waiting_for_user");
  assert.equal(mediaInvoked, false);
  assert.equal(result.steps[1].status, "skipped");
  assert.equal(result.steps[0].result.details.decision, "approval_required");
});

test("worker failures stop later steps and preserve a sanitized failure code", async () => {
  const run = createSpecialistRun("Create a video storyboard.");
  const result = await executeSpecialistRun(run, safeAdapters({
    media_creator: async () => { throw Object.assign(new Error("sensitive raw provider message"), { code: "MEDIA_TIMEOUT" }); }
  }));
  assert.equal(result.status, "failed");
  assert.equal(result.steps[1].status, "failed");
  assert.equal(result.steps[1].result.details.failureCode, "MEDIA_TIMEOUT");
  assert.equal(result.steps[1].result.summary.includes("sensitive raw provider message"), false);
  assert.equal(result.steps[2].status, "skipped");
});

test("verification failure results in needs_review rather than a false success", async () => {
  const run = createSpecialistRun("Create a video storyboard.");
  const result = await executeSpecialistRun(run, safeAdapters({
    verification: async () => ({ status: "completed", summary: "No durable artifact evidence was found.", verification: { passed: false, checks: [{ name: "Artifact exists", passed: false, evidence: "Not found" }] } })
  }));
  assert.equal(result.status, "needs_review");
});

test("public evidence accepts only safe HTTPS URLs and strips sensitive query parameters", async () => {
  const run = createSpecialistRun("Research current science sources.");
  const result = await executeSpecialistRun(run, {
    security: safeAdapters().security,
    research: async () => ({
      status: "completed",
      summary: "One public source was reviewed.",
      evidence: [
        { title: "Official source", url: "https://example.com/research?token=secret&year=2026" },
        { title: "Insecure source", url: "http://example.com" }
      ]
    }),
    verification: async ({ completedSteps }) => ({
      status: "completed",
      summary: "Research result checked.",
      verification: { passed: true, checks: [{ name: "Research evidence is recorded", passed: completedSteps.some((item) => item.workerId === "research"), evidence: "Research step completed" }] }
    })
  });
  assert.equal(result.status, "completed");
  assert.equal(result.steps[1].result.evidence.length, 1);
  assert.equal(result.steps[1].result.evidence[0].url, "https://example.com/research?year=2026");
});

test("interrupted specialist runs are preserved for review and never automatically replayed", () => {
  const run = createSpecialistRun("Create a video storyboard.");
  run.status = "running";
  run.steps[0].status = "completed";
  run.steps[0].result = { status: "completed", summary: "Policy passed.", details: { decision: "allow" } };
  run.steps[1].status = "running";
  const recovered = recoverInterruptedSpecialistRuns([run], "2026-11-03T12:00:00.000Z")[0];
  assert.equal(recovered.status, "needs_review");
  assert.equal(recovered.steps[0].status, "completed");
  assert.equal(recovered.steps[1].status, "needs_review");
  assert.equal(recovered.steps[2].status, "skipped");
});

test("normalization rejects malformed persisted worker histories", () => {
  const run = createSpecialistRun("Create a video storyboard.");
  assert.equal(normalizeSpecialistRun(run).id, run.id);
  assert.equal(normalizeSpecialistRun({ ...run, workerIds: ["security", "root", "verification"] }), null);
});
