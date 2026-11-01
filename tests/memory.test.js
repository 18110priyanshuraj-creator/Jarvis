import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMemoryContext,
  isDuplicateMemory,
  isSafeMemoryContent,
  normalizeMemory,
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
