import crypto from "node:crypto";

const MAX_SKILLS = 100;
const MAX_NAME = 80;
const MAX_INSTRUCTIONS = 2500;
const MAX_TRIGGERS = 8;
const MAX_TEST_CASES = 12;
const VALID_STATUSES = new Set(["draft", "active", "update-pending", "paused"]);
const UNSAFE_SKILL_PATTERN = /\b(?:ignore (?:all |previous )?instructions|reveal (?:the )?(?:password|api key|secret|credentials)|bypass (?:authentication|security|permissions|the lock)|steal (?:data|credentials)|exfiltrat\w*|execute (?:arbitrary )?(?:code|shell)|run (?:shell|terminal|powershell) commands?|delete (?:all )?(?:files|data)|transfer money|make (?:a )?payment|place (?:an )?order|send (?:a )?(?:message|email|sms) automatically)\b/i;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizePhrase(value) {
  return cleanText(value, 120).normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
}

function safeContent(value) {
  return !UNSAFE_SKILL_PATTERN.test(value);
}

function normalizeTriggers(value) {
  const input = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const triggers = [];
  const seen = new Set();
  for (const raw of input) {
    const trigger = cleanText(raw, 80).replace(/\s+/g, " ");
    const normalized = normalizePhrase(trigger);
    if (normalized.length < 3 || seen.has(normalized)) continue;
    seen.add(normalized);
    triggers.push(trigger);
    if (triggers.length >= MAX_TRIGGERS) break;
  }
  return triggers;
}

function normalizeTests(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_TEST_CASES).flatMap((item) => {
    const input = cleanText(item?.input, 300);
    if (input.length < 3 || typeof item?.shouldMatch !== "boolean") return [];
    return [{ input, shouldMatch: item.shouldMatch }];
  });
}

function makeSnapshot(input, version, createdAt) {
  return {
    version,
    name: cleanText(input.name, MAX_NAME),
    instructions: cleanText(input.instructions, MAX_INSTRUCTIONS),
    triggers: normalizeTriggers(input.triggers),
    testCases: normalizeTests(input.testCases),
    createdAt,
    validation: input.validation && typeof input.validation === "object" ? input.validation : null,
    approvedAt: typeof input.approvedAt === "string" ? input.approvedAt : ""
  };
}

function deriveStatus(skill) {
  if (skill.paused) return "paused";
  if (skill.activeVersion && skill.activeVersion === skill.currentVersion) return "active";
  if (skill.activeVersion) return "update-pending";
  return "draft";
}

export function normalizeSkill(input = {}) {
  const now = new Date().toISOString();
  const id = cleanText(input.id, 80) || crypto.randomUUID();
  let versions = Array.isArray(input.versions) ? input.versions.slice(-50).flatMap((entry) => {
    const version = Number(entry?.version);
    if (!Number.isInteger(version) || version < 1) return [];
    const snapshot = makeSnapshot(entry, version, cleanText(entry.createdAt, 80) || now);
    if (!snapshot.name || !snapshot.instructions) return [];
    return [snapshot];
  }) : [];

  if (!versions.length) {
    const legacyVersion = Number.isInteger(input.version) && input.version > 0 ? input.version : 1;
    const legacyStatus = VALID_STATUSES.has(input.status) ? input.status : "active";
    const snapshot = makeSnapshot(input, legacyVersion, cleanText(input.createdAt, 80) || now);
    if (!snapshot.name || !snapshot.instructions) {
      throw new TypeError("A skill needs a name and instructions.");
    }
    versions = [snapshot];
    const activeVersion = Number.isInteger(input.activeVersion)
      ? input.activeVersion
      : legacyStatus === "draft" || legacyStatus === "paused" ? null : legacyVersion;
    input = { ...input, activeVersion };
  }

  versions.sort((a, b) => a.version - b.version);
  const maxVersion = versions.at(-1).version;
  const currentVersion = Number.isInteger(input.currentVersion) && versions.some((v) => v.version === input.currentVersion)
    ? input.currentVersion
    : maxVersion;
  const current = versions.find((v) => v.version === currentVersion);
  const activeVersion = Number.isInteger(input.activeVersion) && versions.some((v) => v.version === input.activeVersion)
    ? input.activeVersion
    : null;

  const skill = {
    id,
    name: current.name,
    instructions: current.instructions,
    triggers: current.triggers,
    testCases: current.testCases,
    versions,
    currentVersion,
    activeVersion,
    paused: input.paused === true,
    status: "draft",
    createdAt: cleanText(input.createdAt, 80) || current.createdAt || now,
    updatedAt: cleanText(input.updatedAt, 80) || now
  };
  skill.status = deriveStatus(skill);
  return skill;
}

export function createSkillCandidate(input = {}) {
  const name = cleanText(input.name, MAX_NAME);
  const instructions = cleanText(input.instructions, MAX_INSTRUCTIONS);
  if (name.length < 3 || instructions.length < 20) {
    throw new TypeError("Skill name must be at least 3 characters and instructions at least 20 characters.");
  }
  if (!safeContent(name + "\n" + instructions)) {
    throw new TypeError("This skill contains an unsafe instruction and cannot be saved.");
  }
  const now = new Date().toISOString();
  const snapshot = makeSnapshot({ ...input, name, instructions }, 1, now);
  return normalizeSkill({
    id: crypto.randomUUID(),
    versions: [snapshot],
    currentVersion: 1,
    activeVersion: null,
    paused: false,
    createdAt: now,
    updatedAt: now
  });
}

export function createSkillVersion(skillInput, input = {}) {
  const skill = normalizeSkill(skillInput);
  const name = cleanText(input.name, MAX_NAME);
  const instructions = cleanText(input.instructions, MAX_INSTRUCTIONS);
  if (name.length < 3 || instructions.length < 20) {
    throw new TypeError("Skill name must be at least 3 characters and instructions at least 20 characters.");
  }
  if (!safeContent(name + "\n" + instructions)) {
    throw new TypeError("This skill contains an unsafe instruction and cannot be saved.");
  }

  const now = new Date().toISOString();
  const nextVersion = skill.versions.reduce((max, item) => Math.max(max, item.version), 0) + 1;
  const snapshot = makeSnapshot({ ...input, name, instructions }, nextVersion, now);
  return normalizeSkill({
    ...skill,
    name,
    instructions,
    triggers: snapshot.triggers,
    testCases: snapshot.testCases,
    versions: [...skill.versions, snapshot],
    currentVersion: nextVersion,
    updatedAt: now,
    paused: false
  });
}

function matchesTrigger(input, triggers) {
  const normalizedInput = normalizePhrase(input);
  return triggers.some((trigger) => {
    const phrase = normalizePhrase(trigger);
    return phrase.length >= 3 && normalizedInput.includes(phrase);
  });
}

export function validateSkill(skillInput) {
  const skill = normalizeSkill(skillInput);
  const current = skill.versions.find((version) => version.version === skill.currentVersion);
  const checks = [];
  checks.push({
    name: "Name and instructions",
    passed: current.name.length >= 3 && current.instructions.length >= 20 && current.instructions.length <= MAX_INSTRUCTIONS
  });
  checks.push({
    name: "Trigger phrases",
    passed: current.triggers.length >= 1 && current.triggers.every((trigger) => normalizePhrase(trigger).length >= 3)
  });
  checks.push({
    name: "Safe instruction text",
    passed: safeContent(current.name + "\n" + current.instructions)
  });
  checks.push({
    name: "Positive and negative test coverage",
    passed: current.testCases.length >= 2 &&
      current.testCases.some((item) => item.shouldMatch) &&
      current.testCases.some((item) => !item.shouldMatch)
  });

  const caseResults = current.testCases.map((item, index) => {
    const actualMatch = matchesTrigger(item.input, current.triggers);
    return {
      index: index + 1,
      input: item.input,
      expectedMatch: item.shouldMatch,
      actualMatch,
      passed: actualMatch === item.shouldMatch
    };
  });
  const testsPassed = caseResults.length >= 2 && caseResults.every((item) => item.passed);
  checks.push({ name: "Trigger tests", passed: testsPassed });

  const passed = checks.every((item) => item.passed);
  const validation = {
    version: current.version,
    passed,
    testedAt: new Date().toISOString(),
    checks,
    caseResults,
    mode: "static-trigger-check"
  };
  const versions = skill.versions.map((entry) =>
    entry.version === current.version ? { ...entry, validation } : entry
  );

  return {
    skill: normalizeSkill({ ...skill, versions, updatedAt: validation.testedAt }),
    validation
  };
}

export function approveSkill(skillInput) {
  const skill = normalizeSkill(skillInput);
  const current = skill.versions.find((version) => version.version === skill.currentVersion);
  if (!current?.validation?.passed || current.validation.version !== current.version) {
    throw new Error("Run and pass the current version's skill tests before approving it.");
  }
  const now = new Date().toISOString();
  const versions = skill.versions.map((entry) =>
    entry.version === current.version ? { ...entry, approvedAt: now } : entry
  );
  return normalizeSkill({
    ...skill,
    versions,
    activeVersion: current.version,
    paused: false,
    updatedAt: now
  });
}

export function pauseSkill(skillInput) {
  const skill = normalizeSkill(skillInput);
  return normalizeSkill({ ...skill, paused: true, updatedAt: new Date().toISOString() });
}

export function getActiveSkillContext(skills, message, limit = 3) {
  const input = cleanText(message, 4000);
  if (!Array.isArray(skills) || !input) return [];
  return skills.flatMap((raw) => {
    let skill;
    try { skill = normalizeSkill(raw); } catch { return []; }
    if (skill.paused || !skill.activeVersion) return [];
    const active = skill.versions.find((entry) => entry.version === skill.activeVersion);
    if (!active || !matchesTrigger(input, active.triggers)) return [];
    return [{
      name: active.name,
      version: active.version,
      instructions: active.instructions,
      triggers: active.triggers
    }];
  }).slice(0, Math.min(5, Math.max(1, limit)));
}

export const SKILL_LIMITS = Object.freeze({
  skills: MAX_SKILLS,
  name: MAX_NAME,
  instructions: MAX_INSTRUCTIONS,
  triggers: MAX_TRIGGERS,
  testCases: MAX_TEST_CASES
});
