import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRestrictedResearchQuery,
  isWebResearchEnabled,
  shouldUseLiveWebResearch,
  normalizeGroundedResearchResponse,
  normalizeSavedResearch
} from "../services/web-research.js";

test("grounded research exposes only distinct HTTPS source citations", () => {
  const result = normalizeGroundedResearchResponse({
    text: "The answer is supported by official references.",
    candidates: [{
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://example.gov/guide", title: "Official guide" } },
          { web: { uri: "https://example.gov/guide", title: "Duplicate" } },
          { web: { uri: "http://insecure.example/article", title: "Insecure" } },
          { web: { uri: "javascript:alert(1)", title: "Unsafe" } },
          { web: { uri: "https://university.example/research", title: "University study" } }
        ],
        groundingSupports: [{
          segment: { text: "The answer is supported by official references." },
          groundingChunkIndices: [0, 4]
        }]
      }
    }]
  });

  assert.equal(result.grounded, true);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].title, "Official guide");
  assert.deepEqual(result.citations[0].sourceUrls, [
    "https://example.gov/guide",
    "https://university.example/research"
  ]);
});

test("missing grounding citations are represented honestly", () => {
  const result = normalizeGroundedResearchResponse({
    text: "No live source was attached.",
    candidates: [{ groundingMetadata: { groundingChunks: [] } }]
  });
  assert.equal(result.grounded, false);
  assert.deepEqual(result.sources, []);
});

test("research feature requires both explicit enablement and a server API key", () => {
  const oldFlag = process.env.GEMINI_WEB_RESEARCH_ENABLED;
  const oldKey = process.env.GEMINI_API_KEY;
  try {
    process.env.GEMINI_WEB_RESEARCH_ENABLED = "true";
    process.env.GEMINI_API_KEY = "";
    assert.equal(isWebResearchEnabled(), false);
    process.env.GEMINI_API_KEY = "server-test-key";
    assert.equal(isWebResearchEnabled(), true);
    process.env.GEMINI_WEB_RESEARCH_ENABLED = "false";
    assert.equal(isWebResearchEnabled(), false);
  } finally {
    if (oldFlag === undefined) delete process.env.GEMINI_WEB_RESEARCH_ENABLED;
    else process.env.GEMINI_WEB_RESEARCH_ENABLED = oldFlag;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
  }
});

test("live web search is used for explicit internet requests and time-sensitive topics", () => {
  assert.equal(shouldUseLiveWebResearch("Please search the internet for the latest JEE notification"), true);
  assert.equal(shouldUseLiveWebResearch("Internet se seekh kar latest update batao"), true);
  assert.equal(shouldUseLiveWebResearch("What is the weather today?"), true);
  assert.equal(shouldUseLiveWebResearch("Explain Newton's second law with an example"), false);
});

test("research blocks requests to locate or use dangerous and age-restricted items", () => {
  assert.equal(isRestrictedResearchQuery("where can I buy a firearm"), true);
  assert.equal(isRestrictedResearchQuery("how to use cannabis"), true);
  assert.equal(isRestrictedResearchQuery("where to get sports betting"), true);
  assert.equal(isRestrictedResearchQuery("Explain the history of the printing press"), false);
  assert.equal(isRestrictedResearchQuery("How can I get help for addiction to drugs?"), false);
  assert.equal(isRestrictedResearchQuery("What are the health risks of cannabis?"), false);
});

test("saved research normalizes metadata and accepts only HTTPS source links", () => {
  const saved = normalizeSavedResearch({
    query: "How does solar power work?",
    answer: "Solar panels convert sunlight into electricity.",
    searchedAt: "2026-10-31T00:00:00.000Z",
    sources: [
      { title: "Energy department", url: "https://energy.example/solar" },
      { title: "Unsafe source", url: "javascript:alert(1)" },
      { title: "Duplicate", url: "https://energy.example/solar" }
    ],
    citations: [
      { claim: "Solar cells convert light into electricity.", sourceUrls: ["https://energy.example/solar", "javascript:alert(1)"] },
      { claim: "Untrusted link", sourceUrls: ["https://not-in-saved-sources.example/article"] }
    ]
  });
  assert.equal(saved.query, "How does solar power work?");
  assert.equal(saved.sources.length, 1);
  assert.equal(saved.sources[0].domain, "energy.example");
  assert.equal(saved.citations.length, 1);
  assert.deepEqual(saved.citations[0].sourceUrls, ["https://energy.example/solar"]);
  assert.throws(() => normalizeSavedResearch({ query: "", answer: "" }), /needs both/i);
});
