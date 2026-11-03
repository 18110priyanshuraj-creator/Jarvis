import crypto from "node:crypto";

const MAX_PROGRAMS = 50;
const MAX_VERSIONS = 25;
const MAX_NAME = 80;
const MAX_INPUT = 1200;
const MAX_OUTPUT = 2000;
const MAX_CASES = 10;
const MAX_PHRASES = 8;
const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "with"]);
const SENSITIVE_INPUT = /(?:\b(?:api[_ -]?key|password|passcode|bearer\s+[a-z0-9._-]{8,}|secret\s*[:=]|private key|one.?time password|otp)\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?\d[\d\s().-]{8,}\d))/i;
const ALLOWED_PLACEHOLDERS = new Set(["input", "keywords", "matched"]);

function cleanText(value, max) {
  return typeof value === "string" ? value.normalize("NFKC").trim().slice(0, max) : "";
}

function normalizePhrase(value) {
  return cleanText(value, 120).toLocaleLowerCase().replace(/\s+/g, " ");
}

function isSafeInput(value) {
  return typeof value === "string" && value.length <= MAX_INPUT && !SENSITIVE_INPUT.test(value);
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}

export function normalizeSkillProgramSpec(input) {
  if (!exactKeys(input, ["steps"]) || !Array.isArray(input.steps) || input.steps.length !== 4) {
    throw new TypeError("A skill program must contain exactly four ordered, allow-listed steps.");
  }
  const [normalize, extract, match, format] = input.steps;
  if (!exactKeys(normalize, ["op"]) || normalize.op !== "normalize_input") {
    throw new TypeError("Step 1 must be normalize_input and contain no extra fields.");
  }
  if (!exactKeys(extract, ["op", "max"]) || extract.op !== "extract_keywords" ||
      !Number.isInteger(extract.max) || extract.max < 1 || extract.max > 8) {
    throw new TypeError("Step 2 must extract between 1 and 8 keywords.");
  }
  if (!exactKeys(match, ["op", "phrases"]) || match.op !== "match_any" ||
      !Array.isArray(match.phrases) || match.phrases.length < 1 || match.phrases.length > MAX_PHRASES) {
    throw new TypeError("Step 3 must contain 1 to 8 match phrases.");
  }
  const phrases = [];
  const seen = new Set();
  for (const raw of match.phrases) {
    const phrase = normalizePhrase(raw);
    if (phrase.length < 3 || phrase.length > 80) {
      throw new TypeError("Match phrases must be between 3 and 80 characters.");
    }
    if (!seen.has(phrase)) {
      seen.add(phrase);
      phrases.push(phrase);
    }
  }
  if (!exactKeys(format, ["op", "template"]) || format.op !== "format_output") {
    throw new TypeError("Step 4 must format the result using a bounded template.");
  }
  const template = cleanText(format.template, 800);
  if (template.length < 1 || template.length > 800) {
    throw new TypeError("Output template must be between 1 and 800 characters.");
  }
  const placeholders = [...template.matchAll(/\{([^{}]+)\}/g)].map((item) => item[1]);
  if (placeholders.some((item) => !ALLOWED_PLACEHOLDERS.has(item)) ||
      /\{[^{}]*\}/.test(template.replace(/\{(?:input|keywords|matched)\}/g, ""))) {
    throw new TypeError("Only {input}, {keywords}, and {matched} template placeholders are allowed.");
  }
  return {
    steps: [
      { op: "normalize_input" },
      { op: "extract_keywords", max: extract.max },
      { op: "match_any", phrases },
      { op: "format_output", template }
    ]
  };
}

function normalizeCases(value) {
  if (!Array.isArray(value) || value.length > MAX_CASES) {
    throw new TypeError("Provide between 2 and 10 skill-program test cases.");
  }
  const cases = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some((key) => !["input", "expectedMatched"].includes(key)) ||
        typeof item.expectedMatched !== "boolean" || !isSafeInput(item.input)) return [];
    const input = item.input.trim();
    return input.length >= 3 ? [{ input, expectedMatched: item.expectedMatched }] : [];
  });
  if (cases.length !== value.length || cases.length < 2 ||
      !cases.some((item) => item.expectedMatched) ||
      !cases.some((item) => !item.expectedMatched)) {
    throw new TypeError("Tests must include 2 to 10 safe inputs with both matching and non-matching expectations.");
  }
  return cases;
}

function makeVersion(input, version, createdAt) {
  return {
    version,
    name: cleanText(input.name, MAX_NAME),
    program: normalizeSkillProgramSpec(input.program),
    testCases: normalizeCases(input.testCases),
    validation: input.validation && typeof input.validation === "object" ? input.validation : null,
    approvedAt: typeof input.approvedAt === "string" ? input.approvedAt : "",
    createdAt
  };
}

function digestSpec(program) {
  return crypto.createHash("sha256").update(JSON.stringify(program)).digest("hex");
}

function deriveStatus(record) {
  if (record.paused) return "paused";
  if (record.activeVersion && record.activeVersion === record.currentVersion) return "approved";
  if (record.activeVersion) return "update-pending";
  return "draft";
}

export function normalizeSkillProgram(input = {}) {
  const now = new Date().toISOString();
  const id = cleanText(input.id, 80) || crypto.randomUUID();
  const versions = Array.isArray(input.versions)
    ? input.versions.slice(-MAX_VERSIONS).flatMap((item) => {
        const version = Number(item?.version);
        if (!Number.isInteger(version) || version < 1) return [];
        try {
          return [makeVersion(item, version, cleanText(item.createdAt, 80) || now)];
        } catch { return []; }
      }).sort((a, b) => a.version - b.version)
    : [];
  if (!versions.length) return null;
  const currentVersion = versions.some((item) => item.version === input.currentVersion)
    ? input.currentVersion
    : versions.at(-1).version;
  const activeVersion = versions.some((item) => item.version === input.activeVersion)
    ? input.activeVersion
    : null;
  const current = versions.find((item) => item.version === currentVersion);
  const record = {
    id,
    skillId: cleanText(input.skillId, 80),
    skillVersion: Number.isInteger(input.skillVersion) && input.skillVersion > 0 ? input.skillVersion : 1,
    versions,
    currentVersion,
    activeVersion,
    paused: input.paused === true,
    name: current.name,
    program: current.program,
    testCases: current.testCases,
    createdAt: cleanText(input.createdAt, 80) || versions[0].createdAt || now,
    updatedAt: cleanText(input.updatedAt, 80) || now,
    status: "draft"
  };
  record.status = deriveStatus(record);
  return record;
}

function requireActiveSkill(skills, skillId) {
  const skill = Array.isArray(skills) ? skills.find((item) => item.id === skillId) : null;
  if (!skill || skill.paused || skill.status !== "active" ||
      !Number.isInteger(skill.activeVersion) || skill.activeVersion !== skill.currentVersion) {
    throw new Error("Select an existing skill whose current version is approved and active.");
  }
  return skill;
}

export function createSkillProgramCandidate(input = {}, skills = []) {
  const skill = requireActiveSkill(skills, cleanText(input.skillId, 80));
  const name = cleanText(input.name, MAX_NAME);
  if (name.length < 3) throw new TypeError("Program name must be at least 3 characters.");
  const now = new Date().toISOString();
  const version = makeVersion({
    name,
    program: input.program,
    testCases: input.testCases
  }, 1, now);
  return normalizeSkillProgram({
    id: crypto.randomUUID(),
    skillId: skill.id,
    skillVersion: skill.activeVersion,
    versions: [version],
    currentVersion: 1,
    activeVersion: null,
    paused: false,
    createdAt: now,
    updatedAt: now
  });
}

export function createSkillProgramVersion(existingInput, input = {}, skills = []) {
  const existing = normalizeSkillProgram(existingInput);
  if (!existing) throw new TypeError("Saved skill program is invalid.");
  const skill = requireActiveSkill(skills, existing.skillId);
  const name = cleanText(input.name, MAX_NAME);
  if (name.length < 3) throw new TypeError("Program name must be at least 3 characters.");
  const nextVersion = existing.versions.reduce((max, item) => Math.max(max, item.version), 0) + 1;
  const version = makeVersion({
    name,
    program: input.program,
    testCases: input.testCases
  }, nextVersion, new Date().toISOString());
  return normalizeSkillProgram({
    ...existing,
    skillVersion: skill.activeVersion,
    versions: [...existing.versions, version],
    currentVersion: nextVersion,
    updatedAt: new Date().toISOString()
  });
}

function executeSpec(specInput, input) {
  const spec = normalizeSkillProgramSpec(specInput);
  if (!isSafeInput(input) || input.trim().length < 1) {
    throw new TypeError("Input must be non-empty, under 1,200 characters and free of secrets or contact details.");
  }
  const normalized = input.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
  const maxKeywords = spec.steps[1].max;
  const words = normalized.match(/[\p{L}\p{N}]{2,}/gu) || [];
  const keywords = [...new Set(words.filter((word) => !STOP_WORDS.has(word)))].slice(0, maxKeywords);
  const matchedPhrases = spec.steps[2].phrases.filter((phrase) => normalized.includes(phrase));
  const matched = matchedPhrases.length > 0;
  const output = spec.steps[3].template
    .replaceAll("{input}", input.trim())
    .replaceAll("{keywords}", keywords.join(", "))
    .replaceAll("{matched}", matched ? "yes" : "no");
  if (output.length > MAX_OUTPUT) throw new TypeError("Program output exceeded the 2,000-character limit.");
  return { matched, keywords, output };
}

export function validateSkillProgram(programInput) {
  const program = normalizeSkillProgram(programInput);
  if (!program) throw new TypeError("Saved skill program is invalid.");
  const current = program.versions.find((item) => item.version === program.currentVersion);
  const programHash = digestSpec(current.program);
  const results = current.testCases.map((item, index) => {
    const actual = executeSpec(current.program, item.input).matched;
    return {
      index: index + 1,
      expectedMatched: item.expectedMatched,
      actualMatched: actual,
      passed: actual === item.expectedMatched
    };
  });
  const validation = {
    version: current.version,
    programHash,
    passed: results.length >= 2 && results.every((item) => item.passed),
    caseResults: results,
    testsRun: results.length,
    testedAt: new Date().toISOString(),
    mode: "allow-listed-dsl"
  };
  const versions = program.versions.map((item) =>
    item.version === current.version ? { ...item, validation } : item
  );
  return {
    program: normalizeSkillProgram({ ...program, versions, updatedAt: validation.testedAt }),
    validation
  };
}

export function approveSkillProgram(programInput, skills = []) {
  const program = normalizeSkillProgram(programInput);
  if (!program) throw new TypeError("Saved skill program is invalid.");
  const skill = requireActiveSkill(skills, program.skillId);
  if (skill.activeVersion !== program.skillVersion) {
    throw new Error("The linked skill changed. Create and test a new program version against its currently approved version.");
  }
  const current = program.versions.find((item) => item.version === program.currentVersion);
  if (!current?.validation?.passed ||
      current.validation.version !== current.version ||
      current.validation.programHash !== digestSpec(current.program)) {
    throw new Error("Run and pass the current program version's tests before approval.");
  }
  const now = new Date().toISOString();
  const versions = program.versions.map((item) =>
    item.version === current.version ? { ...item, approvedAt: now } : item
  );
  return normalizeSkillProgram({
    ...program,
    versions,
    activeVersion: current.version,
    paused: false,
    updatedAt: now
  });
}

export function pauseSkillProgram(programInput) {
  const program = normalizeSkillProgram(programInput);
  if (!program) throw new TypeError("Saved skill program is invalid.");
  return normalizeSkillProgram({ ...program, paused: true, updatedAt: new Date().toISOString() });
}

export function runApprovedSkillProgram(programInput, skills, input, applicationId = "web-dashboard") {
  const program = normalizeSkillProgram(programInput);
  if (!program || program.paused || !program.activeVersion || program.activeVersion !== program.currentVersion) {
    throw new Error("Only an approved, current and unpaused skill program can run.");
  }
  const skill = requireActiveSkill(skills, program.skillId);
  if (skill.activeVersion !== program.skillVersion) {
    throw new Error("The linked skill changed. Revalidate and approve a new program version before running.");
  }
  const currentSkill = (skill.versions || []).find((item) => item.version === skill.activeVersion) || skill;
  const requestedApp = cleanText(applicationId, 80).toLocaleLowerCase();
  const inScope = Array.isArray(currentSkill.applicationIds) &&
    (currentSkill.applicationIds.includes("*") || currentSkill.applicationIds.includes(requestedApp));
  const normalizedInput = input.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");
  const triggered = Array.isArray(currentSkill.triggers) &&
    currentSkill.triggers.some((trigger) => normalizedInput.includes(String(trigger).normalize("NFKC").toLocaleLowerCase()));
  if (!inScope || !triggered) throw new Error("The linked skill's approved trigger or application scope does not match this request.");
  const current = program.versions.find((item) => item.version === program.activeVersion);
  const result = executeSpec(current.program, input);
  return {
    programId: program.id,
    programVersion: current.version,
    skillId: skill.id,
    skillVersion: skill.activeVersion,
    matched: result.matched,
    keywords: result.keywords,
    output: result.output,
    executionMode: "isolated-allow-listed-dsl",
    sideEffects: false
  };
}

export const SKILL_CRUCIBLE_LIMITS = Object.freeze({
  programs: MAX_PROGRAMS,
  versions: MAX_VERSIONS,
  name: MAX_NAME,
  input: MAX_INPUT,
  output: MAX_OUTPUT,
  testCases: MAX_CASES,
  phrases: MAX_PHRASES,
  maxKeywords: 8,
  steps: 4
});

export function getSkillCrucibleStatus(programs = []) {
  return {
    runtime: "allow-listed-dsl",
    arbitraryCodeExecution: false,
    shellAccess: false,
    filesystemAccess: false,
    networkAccess: false,
    deviceActions: false,
    manualApprovalRequired: true,
    programs: Array.isArray(programs) ? programs.length : 0,
    limits: SKILL_CRUCIBLE_LIMITS
  };
}
