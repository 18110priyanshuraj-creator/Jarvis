import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMemoryContext,
  isDuplicateMemory,
  isSafeMemoryContent,
  normalizeMemory,
  searchMemories
} from "../services/memory.js";

test("memory records normalize legacy fields and use stable category and timestamps", () => {
  const item = normalizeMemory({
    id: "legacy-id",
    content: "  Prefer   short Hinglish explanations. ",
    category: "preference",
    createdAt: "2026-10-01T00:00:00.000Z"
  });
  assert.equal(item.id, "legacy-id");
  assert.equal(item.content, "Prefer short Hinglish explanations.");
  assert.equal(item.category, "preference");
  assert.equal(item.createdAt, "2026-10-01T00:00:00.000Z");
  assert.equal(item.updatedAt, item.createdAt);
  assert.equal(typeof item.contentHash, "string");
});

test("memory rejects likely secrets and sensitive personal records", () => {
  assert.equal(isSafeMemoryContent("Prefer simple explanations"), true);
  assert.equal(isSafeMemoryContent("GEMINI_API_KEY: fake-secret-value"), false);
  assert.equal(isSafeMemoryContent("My password is example123"), false);
  assert.equal(isSafeMemoryContent("My medical diagnosis is ..."), false);
  assert.throws(() => normalizeMemory({ content: "Bearer abcdefghijklmnopqrstuvwxyz123456" }), /privacy/i);
});

test("memory deduplication ignores case, Unicode form and repeated whitespace", () => {
  const saved = normalizeMemory({ content: "I prefer clear explanations" });
  const duplicate = normalizeMemory({ content: " i   PREFER clear explanations " });
  assert.equal(isDuplicateMemory([saved], duplicate), true);
});

test("memory search ranks matching entries and respects category filters", () => {
  const preference = normalizeMemory({ content: "I prefer short step-by-step examples", category: "preference" });
  const goal = normalizeMemory({ content: "Learn algebra with daily practice", category: "goal" });
  const results = searchMemories([goal, preference], "step-by-step", "", 10);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, preference.id);
  assert.equal(searchMemories([goal, preference], "", "goal", 10).length, 1);
});

test("memory context includes only relevant notes, with a strict item limit", () => {
  const one = normalizeMemory({ content: "I prefer short Hinglish explanations", category: "preference" });
  const two = normalizeMemory({ content: "My goal is learning algebra", category: "goal" });
  const unrelated = normalizeMemory({ content: "I prefer science documentaries", category: "preference" });
  const context = buildMemoryContext([one, two, unrelated], "Hinglish explanations", 2);
  assert.equal(context.length, 1);
  assert.equal(context[0].id, one.id);
});
