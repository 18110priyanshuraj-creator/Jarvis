import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildKnowledgeContext,
  isDuplicateKnowledge,
  normalizeKnowledgeItem,
  searchKnowledgeItems
} from "../services/knowledge.js";

test("knowledge normalizes fields and preserves only HTTPS sources and linked citations", () => {
  const item = normalizeKnowledgeItem({
    title: "Solar energy basics",
    content: "Solar panels convert light into electrical energy.",
    category: "science",
    tags: ["Energy", "solar", "solar", "Renewable"],
    sourceKind: "web-research",
    sources: [
      { title: "Official source", url: "https://energy.example/solar" },
      { title: "Unsafe", url: "javascript:alert(1)" },
      { title: "Duplicate", url: "https://energy.example/solar" }
    ],
    citations: [
      { claim: "Panels convert light into electricity.", sourceUrls: ["https://energy.example/solar"] },
      { claim: "Unrelated claim", sourceUrls: ["https://not-saved.example/page"] }
    ]
  });
  assert.equal(item.category, "science");
  assert.deepEqual(item.tags, ["Energy", "solar", "Renewable"]);
  assert.equal(item.sources.length, 1);
  assert.equal(item.sources[0].domain, "energy.example");
  assert.equal(item.citations.length, 1);
  assert.equal(item.reviewStatus, "unreviewed");
  assert.equal(item.sourceKind, "web-research");
});

test("manual knowledge is marked as user-authored rather than independently verified", () => {
  const item = normalizeKnowledgeItem({
    title: "My project note",
    content: "Use small modules and run tests after each change.",
    sourceKind: "manual"
  });
  assert.equal(item.reviewStatus, "user-authored");
  assert.equal(item.sources.length, 0);
});

test("knowledge rejects missing content and likely pasted credentials", () => {
  assert.throws(() => normalizeKnowledgeItem({ title: "Missing body", content: "" }), /title and content/i);
  assert.throws(() => normalizeKnowledgeItem({
    title: "Config",
    content: "GEMINI_API_KEY: this-is-a-test-secret"
  }), /credential or secret/i);
  assert.throws(() => normalizeKnowledgeItem({
    title: "Bearer token",
    content: "Bearer abcdefghijklmnopqrstuvwxyz123456"
  }), /credential or secret/i);
});

test("knowledge search ranks title and tags above body-only matches", () => {
  const titleHit = normalizeKnowledgeItem({
    title: "Solar energy",
    content: "Photovoltaic cells convert light into electrical energy.",
    category: "science",
    tags: ["renewable"]
  });
  const bodyHit = normalizeKnowledgeItem({
    title: "Electricity overview",
    content: "The solar energy conversion process uses photovoltaic cells.",
    category: "science"
  });
  const results = searchKnowledgeItems([bodyHit, titleHit], "solar", 5);
  assert.equal(results[0].id, titleHit.id);
  assert.equal(results.length, 2);
});

test("knowledge context includes source and review metadata for relevant records only", () => {
  const solar = normalizeKnowledgeItem({
    title: "Solar energy",
    content: "Photovoltaic cells produce electricity from light.",
    sourceKind: "web-research",
    sources: [{ title: "Energy guide", url: "https://energy.example/solar" }]
  });
  const unrelated = normalizeKnowledgeItem({
    title: "Mole concept",
    content: "Amount in moles equals mass divided by molar mass."
  });
  const context = buildKnowledgeContext([solar, unrelated], "photovoltaic solar", 2);
  assert.equal(context.length, 1);
  assert.equal(context[0].reviewStatus, "unreviewed");
  assert.equal(context[0].sources[0].url, "https://energy.example/solar");
});

test("duplicate detection uses normalized title and content", () => {
  const original = normalizeKnowledgeItem({
    title: "Solar Energy",
    content: "Solar panels convert sunlight to power."
  });
  const duplicate = normalizeKnowledgeItem({
    title: " solar   energy ",
    content: "SOLAR PANELS convert sunlight to power. "
  });
  assert.equal(isDuplicateKnowledge([original], duplicate), true);
});
