import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildKnowledgeContext,
  isDuplicateKnowledge,
  mergeDuplicateKnowledge,
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

test("knowledge context only includes user-authored notes and web research the user reviewed", () => {
  const unreviewed = normalizeKnowledgeItem({
    title: "Solar energy unreviewed",
    content: "Photovoltaic cells produce electricity from light.",
    sourceKind: "web-research",
    sources: [{ title: "Energy guide", url: "https://energy.example/solar" }]
  });
  const reviewed = normalizeKnowledgeItem({
    title: "Solar energy reviewed",
    content: "Photovoltaic cells convert light into electricity.",
    sourceKind: "web-research",
    reviewStatus: "user-reviewed",
    reviewedAt: "2026-10-30T10:00:00.000Z",
    capturedAt: "2026-10-29T10:00:00.000Z",
    sources: [{
      title: "Energy guide",
      url: "https://energy.example/solar-reviewed",
      publishedAt: "2026-10-20",
      retrievedAt: "2026-10-29T09:00:00.000Z"
    }]
  });
  const rejected = normalizeKnowledgeItem({
    title: "Solar misinformation",
    content: "This untrusted note should never enter assistant context.",
    sourceKind: "web-research",
    reviewStatus: "rejected",
    reviewNote: "The source does not support the claim."
  });
  const manual = normalizeKnowledgeItem({
    title: "Mole concept",
    content: "Amount in moles equals mass divided by molar mass."
  });

  const context = buildKnowledgeContext([unreviewed, reviewed, rejected, manual], "photovoltaic solar", 5);
  assert.equal(context.length, 1);
  assert.equal(context[0].reviewStatus, "user-reviewed");
  assert.equal(context[0].sources[0].url, "https://energy.example/solar-reviewed");
  assert.equal(context[0].capturedAt, "2026-10-29T10:00:00.000Z");
  assert.equal(context[0].sources[0].publishedAt, "2026-10-20T00:00:00.000Z");
  assert.equal(context[0].sources[0].retrievedAt, "2026-10-29T09:00:00.000Z");
});

test("knowledge preserves source publication, retrieval, capture and snippet metadata", () => {
  const item = normalizeKnowledgeItem({
    title: "Source metadata",
    content: "This is a source-backed note.",
    sourceKind: "web-research",
    capturedAt: "2026-10-31T11:00:00.000Z",
    sources: [{
      title: "Official page",
      url: "https://example.org/article#section",
      snippet: "Original search-result context.",
      publishedAt: "2026-10-20",
      retrievedAt: "2026-10-31T10:55:00.000Z"
    }]
  });
  assert.equal(item.capturedAt, "2026-10-31T11:00:00.000Z");
  assert.equal(item.sources[0].url, "https://example.org/article");
  assert.equal(item.sources[0].snippet, "Original search-result context.");
  assert.equal(item.sources[0].publishedAt, "2026-10-20T00:00:00.000Z");
  assert.equal(item.sources[0].retrievedAt, "2026-10-31T10:55:00.000Z");
});

test("duplicate knowledge merges provenance without changing a previous review decision", () => {
  const original = normalizeKnowledgeItem({
    title: "Solar Energy",
    content: "Solar panels convert sunlight to power.",
    sourceKind: "web-research",
    reviewStatus: "user-reviewed",
    sources: [{ title: "First source", url: "https://first.example/solar" }]
  });
  const duplicate = normalizeKnowledgeItem({
    title: " solar   energy ",
    content: "SOLAR PANELS convert sunlight to power. ",
    sourceKind: "web-research",
    sources: [
      { title: "First source duplicate", url: "https://first.example/solar#overview" },
      { title: "Second source", url: "https://second.example/solar", publishedAt: "2026-10-15" }
    ],
    citations: [{ claim: "Solar panels convert sunlight to power.", sourceUrls: ["https://second.example/solar"] }]
  });
  const merged = mergeDuplicateKnowledge(original, duplicate, "2026-11-01T00:00:00.000Z");
  assert.equal(merged.id, original.id);
  assert.equal(merged.reviewStatus, "user-reviewed");
  assert.equal(merged.sources.length, 2);
  assert.equal(merged.citations.length, 1);
  assert.equal(merged.sources[1].url, "https://second.example/solar");
  assert.equal(merged.updatedAt, "2026-11-01T00:00:00.000Z");
  assert.throws(() => mergeDuplicateKnowledge(original, normalizeKnowledgeItem({
    title: "Other note", content: "Different material."
  })), /matching normalized content/i);
});

test("rejected and unreviewed web research remain excluded from assistant context", () => {
  const unreviewed = normalizeKnowledgeItem({
    title: "Unreviewed note",
    content: "A source result awaiting user review.",
    sourceKind: "web-research"
  });
  const rejected = normalizeKnowledgeItem({
    title: "Rejected note",
    content: "A source result rejected by the user.",
    sourceKind: "web-research",
    reviewStatus: "rejected"
  });
  assert.equal(buildKnowledgeContext([unreviewed, rejected], "source", 5).length, 0);
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
