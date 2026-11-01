import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMemoryContext,
  findExactMemory,
  isDuplicateMemory,
  isSafeMemoryContent,
  normalizeMemory,
  parseExplicitForgetIntent,
  previewMemoryContext,
  searchMemories
} from "../services/memory.js";

test("memory records normalize legacy fields and default to enabled", () => {
  const item = normalizeMemory({
    id: "legacy-id",
    content: "  Prefer   short Hinglish explanations. ",
    category: "preference",
    createdAt: "2026-10-01T00:00:00.000Z"
  });
  assert.equal(item.id, "legacy-id");
  assert.equal(item.content, "Prefer short Hinglish explanations.");
  assert.equal(item.category, "preference");
  assert.equal(item.enabled, true);
  assert.equal(item.createdAt, "2026-10-01T00:00:00.000Z");
  assert.equal(item.updatedAt, item.createdAt);
  assert.equal(typeof item.contentHash, "string");
});

test("memory pause state survives normalization", () => {
  const paused = normalizeMemory({ content: "I prefer concise examples", enabled: false });
  const normalizedAgain = normalizeMemory(paused);
  assert.equal(normalizedAgain.enabled, false);
});

test("memory rejects likely secrets and sensitive personal records", () => {
  assert.equal(isSafeMemoryContent("Prefer simple explanations"), true);
  assert.equal(isSafeMemoryContent("GEMINI_API_KEY: fake-secret-value"), false);
  assert.equal(isSafeMemoryContent("My password is example123"), false);
  assert.equal(isSafeMemoryContent("My medical diagnosis is ..."), false);
  assert.equal(isSafeMemoryContent("My religion is ..."), false);
  assert.throws(() => normalizeMemory({ content: "Bearer abcdefghijklmnopqrstuvwxyz123456" }), /privacy/i);
});

test("memory deduplication ignores case, Unicode form and repeated whitespace", () => {
  const saved = normalizeMemory({ content: "I prefer clear explanations" });
  const duplicate = normalizeMemory({ content: " i   PREFER clear explanations " });
  assert.equal(isDuplicateMemory([saved], duplicate), true);
});

test("memory search ranks exact relevant terms and respects category filters", () => {
  const preference = normalizeMemory({ content: "I prefer short step-by-step Hinglish explanations", category: "preference" });
  const goal = normalizeMemory({ content: "Learn algebra with daily practice", category: "goal" });
  const unrelated = normalizeMemory({ content: "I prefer science documentaries", category: "preference" });
  const results = searchMemories([unrelated, goal, preference], "step-by-step Hinglish", "", 10);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, preference.id);
  assert.deepEqual(results[0].matchedTerms, ["step", "hinglish"]);
  assert.equal(searchMemories([goal, preference], "", "goal", 10).length, 1);
});

test("paused memories remain searchable but are excluded from assistant context", () => {
  const active = normalizeMemory({ content: "I prefer short Hinglish explanations", category: "preference" });
  const paused = normalizeMemory({ content: "I prefer detailed physics illustrations", category: "preference", enabled: false });
  const context = buildMemoryContext([active, paused], "Hinglish explanations", 5);
  assert.deepEqual(context.map((item) => item.id), [active.id]);
  assert.equal(searchMemories([active, paused], "", "", 10).length, 2);
});

test("memory preview explains matching enabled notes and counts paused matches", () => {
  const active = normalizeMemory({ content: "I prefer concise Hinglish examples", category: "preference" });
  const paused = normalizeMemory({ content: "I prefer detailed physics illustrations", category: "preference", enabled: false });
  const activePreview = previewMemoryContext([active, paused], "Hinglish examples");
  assert.equal(activePreview.items.length, 1);
  assert.equal(activePreview.items[0].id, active.id);
  assert.deepEqual(activePreview.items[0].matchedTerms, ["hinglish", "examples"]);

  const pausedPreview = previewMemoryContext([active, paused], "detailed physics");
  assert.equal(pausedPreview.items.length, 0);
  assert.equal(pausedPreview.pausedCount, 1);
});

test("context retrieval remains bounded to the configured item limit", () => {
  const records = Array.from({ length: 8 }, (_, index) =>
    normalizeMemory({ content: "I prefer concise examples number " + index, category: "preference" })
  );
  const context = buildMemoryContext(records, "concise examples", 3);
  assert.equal(context.length, 3);
  assert.ok(context.every((item) => item.enabled !== false));
});


test("memory matching ignores query filler words and tolerates inflection", () => {
  const preference = normalizeMemory({ content: "I prefer concise Hinglish explanations", category: "preference" });
  const unrelated = normalizeMemory({ content: "I enjoy science documentaries", category: "preference" });
  const results = searchMemories(
    [unrelated, preference],
    "Jarvis, can you explain in Hinglish?",
    "",
    10
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].id, preference.id);
  assert.ok(results[0].relevance >= 50);
});

test("memory context is capped by both note count and total prompt characters", () => {
  const records = Array.from({ length: 8 }, (_, index) =>
    normalizeMemory({ content: "JEE physics " + String(index) + " " + "x".repeat(470), category: "goal" })
  );
  const context = buildMemoryContext(records, "JEE physics", 8);
  assert.equal(context.length, 5);
  assert.ok(context.reduce((total, item) => total + item.content.length, 0) <= 1800);
});

test("explicit forget accepts English and Hinglish but refuses vague or bulk requests", () => {
  const english = parseExplicitForgetIntent("Forget: I prefer concise explanations");
  assert.deepEqual(english, { content: "I prefer concise explanations", ambiguous: false });

  const hinglish = parseExplicitForgetIntent("Jarvis, bhool jao: I prefer concise explanations");
  assert.deepEqual(hinglish, { content: "I prefer concise explanations", ambiguous: false });

  assert.equal(parseExplicitForgetIntent("Forget everything").ambiguous, true);
  assert.equal(parseExplicitForgetIntent("Forget that").ambiguous, true);
  assert.equal(parseExplicitForgetIntent("I forgot my notebook"), null);
});

test("forget lookup deletes only an exact normalized saved note", () => {
  const saved = normalizeMemory({ content: "I prefer concise explanations", category: "preference" });
  assert.equal(findExactMemory([saved], "  I   prefer concise explanations  ")?.id, saved.id);
  assert.equal(findExactMemory([saved], "I prefer concise"), null);
  assert.equal(findExactMemory([saved], "another note"), null);
});

test("memory privacy filter blocks additional sensitive personal categories", () => {
  assert.equal(isSafeMemoryContent("My political party is ..."), false);
  assert.equal(isSafeMemoryContent("My sexual orientation is ..."), false);
  assert.equal(isSafeMemoryContent("My exact street address is ..."), false);
});


test("memory context preview mirrors the same 1,800-character prompt cap", () => {
  const records = Array.from({ length: 5 }, (_, index) =>
    normalizeMemory({ content: "JEE physics " + index + " " + "x".repeat(470), category: "goal" })
  );
  const preview = previewMemoryContext(records, "JEE physics", 5);
  assert.equal(preview.items.length, 5);
  assert.ok(preview.items.reduce((total, item) => total + item.content.length, 0) <= 1800);
});
