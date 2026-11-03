import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approveSkillProgram,
  createSkillProgramCandidate,
  createSkillProgramVersion,
  getSkillCrucibleStatus,
  normalizeSkillProgramSpec,
  pauseSkillProgram,
  runApprovedSkillProgram,
  validateSkillProgram
} from "../services/skill-crucible.js";

const activeSkill = {
  id: "skill-demo",
  status: "active",
  activeVersion: 2,
  currentVersion: 2,
  paused: false,
  versions: [{
    version: 2,
    applicationIds: ["web-dashboard"],
    triggers: ["explain physics"],
    name: "Physics tutor",
    instructions: "Explain physics questions clearly, show reasoning, and check units."
  }]
};

function candidateInput(overrides = {}) {
  return {
    skillId: activeSkill.id,
    name: "Physics keyword helper",
    program: {
      steps: [
        { op: "normalize_input" },
        { op: "extract_keywords", max: 5 },
        { op: "match_any", phrases: ["explain physics", "physics question"] },
        { op: "format_output", template: "Matched: {matched}. Keywords: {keywords}. Request: {input}" }
      ]
    },
    testCases: [
      { input: "Please explain physics and motion", expectedMatched: true },
      { input: "Tell me today's weather", expectedMatched: false }
    ],
    ...overrides
  };
}

test("program DSL accepts only four ordered allow-listed steps", () => {
  const spec = normalizeSkillProgramSpec(candidateInput().program);
  assert.equal(spec.steps.length, 4);
  assert.throws(() => normalizeSkillProgramSpec({ steps: [{ op: "eval", code: "1+1" }] }), /exactly four/i);
  assert.throws(() => normalizeSkillProgramSpec({
    steps: [
      { op: "normalize_input", code: "extra" },
      { op: "extract_keywords", max: 5 },
      { op: "match_any", phrases: ["physics"] },
      { op: "format_output", template: "ok" }
    ]
  }), /extra fields/i);
});

test("program DSL rejects shell, network, file and unknown template capabilities", () => {
  const base = candidateInput().program.steps;
  assert.throws(() => normalizeSkillProgramSpec({
    steps: [base[0], base[1], base[2], { op: "format_output", template: "{input} {environment}" }]
  }), /placeholders/i);
  assert.throws(() => normalizeSkillProgramSpec({
    steps: [base[0], { op: "read_file", path: "/etc/passwd" }, base[2], base[3]]
  }), /Step 2/i);
  assert.throws(() => normalizeSkillProgramSpec({
    steps: [base[0], { op: "extract_keywords", max: 50 }, base[2], base[3]]
  }), /between 1 and 8/i);
});

test("candidate requires a currently approved skill and both positive and negative tests", () => {
  const draftSkill = { ...activeSkill, status: "draft", activeVersion: null };
  assert.throws(() => createSkillProgramCandidate(candidateInput(), [draftSkill]), /approved and active/i);
  assert.throws(() => createSkillProgramCandidate(candidateInput({
    testCases: [{ input: "Explain physics", expectedMatched: true }]
  }), [activeSkill]), /both matching and non-matching/i);
});

test("program tests are deterministic and report no private test input or generated output", () => {
  const created = createSkillProgramCandidate(candidateInput(), [activeSkill]);
  const tested = validateSkillProgram(created);
  assert.equal(tested.validation.passed, true);
  assert.equal(tested.validation.mode, "allow-listed-dsl");
  assert.equal(tested.validation.testsRun, 2);
  assert.deepEqual(tested.validation.caseResults.map((item) => item.passed), [true, true]);
  assert.equal(JSON.stringify(tested.validation).includes("Please explain physics"), false);
  assert.equal(JSON.stringify(tested.validation).includes("today's weather"), false);
});

test("program cannot be approved until the current program version passes and its hash matches", () => {
  const created = createSkillProgramCandidate(candidateInput(), [activeSkill]);
  assert.throws(() => approveSkillProgram(created, [activeSkill]), /pass the current program/i);
  const tested = validateSkillProgram(created).program;
  const approved = approveSkillProgram(tested, [activeSkill]);
  assert.equal(approved.status, "approved");
  assert.equal(approved.activeVersion, 1);
  const tampered = structuredClone(approved);
  tampered.versions[0].program.steps[3].template = "changed";
  assert.throws(() => approveSkillProgram(tampered, [activeSkill]), /pass the current program/i);
});

test("approved program runs only inside the active skill trigger and application scope", () => {
  const tested = validateSkillProgram(createSkillProgramCandidate(candidateInput(), [activeSkill])).program;
  const approved = approveSkillProgram(tested, [activeSkill]);
  const result = runApprovedSkillProgram(approved, [activeSkill], "Please explain physics motion today");
  assert.equal(result.matched, true);
  assert.equal(result.sideEffects, false);
  assert.equal(result.executionMode, "isolated-allow-listed-dsl");
  assert.match(result.output, /Matched: yes/);
  assert.throws(() => runApprovedSkillProgram(approved, [activeSkill], "Tell me about the weather"), /trigger or application scope/i);
  assert.throws(() => runApprovedSkillProgram(approved, [activeSkill], "Please explain physics", "android-companion"), /trigger or application scope/i);
});

test("program runner rejects secrets and oversized input without storing them", () => {
  const tested = validateSkillProgram(createSkillProgramCandidate(candidateInput(), [activeSkill])).program;
  const approved = approveSkillProgram(tested, [activeSkill]);
  assert.throws(() => runApprovedSkillProgram(approved, [activeSkill], "password: my-secret-value"), /free of secrets/i);
  assert.throws(() => runApprovedSkillProgram(approved, [activeSkill], "x".repeat(1201)), /free of secrets/i);
});

test("program versions require fresh tests and approval; pausing disables execution", () => {
  const first = approveSkillProgram(validateSkillProgram(createSkillProgramCandidate(candidateInput(), [activeSkill])).program, [activeSkill]);
  const updated = createSkillProgramVersion(first, candidateInput({
    name: "Physics keyword helper v2",
    program: {
      steps: [
        { op: "normalize_input" },
        { op: "extract_keywords", max: 3 },
        { op: "match_any", phrases: ["explain physics"] },
        { op: "format_output", template: "Physics result: {matched} — {keywords}" }
      ]
    }
  }), [activeSkill]);
  assert.equal(updated.currentVersion, 2);
  assert.equal(updated.activeVersion, 1);
  assert.equal(updated.status, "update-pending");
  assert.throws(() => runApprovedSkillProgram(updated, [activeSkill], "Please explain physics"));
  const approvedV2 = approveSkillProgram(validateSkillProgram(updated).program, [activeSkill]);
  assert.equal(approvedV2.activeVersion, 2);
  const paused = pauseSkillProgram(approvedV2);
  assert.equal(paused.status, "paused");
  assert.throws(() => runApprovedSkillProgram(paused, [activeSkill], "Please explain physics"));
});

test("crucible status is explicit about unavailable execution capabilities", () => {
  const status = getSkillCrucibleStatus([]);
  assert.equal(status.runtime, "allow-listed-dsl");
  assert.equal(status.arbitraryCodeExecution, false);
  assert.equal(status.shellAccess, false);
  assert.equal(status.filesystemAccess, false);
  assert.equal(status.networkAccess, false);
  assert.equal(status.deviceActions, false);
});
