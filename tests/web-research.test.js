import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWebResearch,
  getWebResearchStatus,
  isRestrictedResearchQuery,
  isWebResearchEnabled,
  normalizeSearchResults,
  normalizeSavedResearch,
  shouldUseLiveWebResearch
} from "../services/web-research.js";

const ENV_KEYS = [
  "NODE_ENV", "JARVIS_SEARCH_BASE_URL", "JARVIS_SEARCH_API_KEY", "JARVIS_SEARCH_ENABLED",
  "JARVIS_SEARCH_TIMEOUT_MS", "JARVIS_SEARCH_RETRY_ATTEMPTS", "JARVIS_SEARCH_MAX_RESULTS",
  "JARVIS_SEARCH_LANGUAGE", "JARVIS_AI_BASE_URL", "JARVIS_AI_API_KEY", "JARVIS_AI_MODEL",
  "JARVIS_AI_ENABLED", "JARVIS_AI_CHAT_ENABLED"
];

async function withEnv(values, callback) {
  const previous = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await callback();
  } finally {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const enabledSearch = {
  NODE_ENV: "test",
  JARVIS_SEARCH_BASE_URL: "http://127.0.0.1:8888",
  JARVIS_SEARCH_ENABLED: "true"
};

test("search stays disabled when the trusted SearXNG endpoint is missing or invalid", async () => {
  await withEnv({ ...enabledSearch, JARVIS_SEARCH_BASE_URL: "" }, async () => {
    assert.equal(isWebResearchEnabled(), false);
    assert.equal(getWebResearchStatus().configured, false);
  });
  await withEnv({
    ...enabledSearch, NODE_ENV: "production", JARVIS_SEARCH_BASE_URL: "http://searx.example"
  }, async () => {
    assert.equal(isWebResearchEnabled(), false);
    assert.equal(getWebResearchStatus().configured, false);
  });
  await withEnv({
    ...enabledSearch, JARVIS_SEARCH_BASE_URL: "https://user:pass@searx.example/?token=x"
  }, async () => {
    assert.equal(getWebResearchStatus().configured, false);
  });
});

test("remote search endpoints require HTTPS while loopback HTTP is development-only", async () => {
  await withEnv({ ...enabledSearch }, async () => {
    assert.equal(isWebResearchEnabled(), true);
    assert.equal(getWebResearchStatus().provider, "searxng");
  });
  await withEnv({
    ...enabledSearch, NODE_ENV: "production", JARVIS_SEARCH_BASE_URL: "https://search.example"
  }, async () => {
    assert.equal(isWebResearchEnabled(), true);
  });
});

test("SearXNG result normalization accepts unique HTTPS links only", () => {
  const results = normalizeSearchResults({
    results: [
      { title: "Official guide", url: "https://example.gov/guide", content: "A useful snippet.", publishedDate: "2026-10-20" },
      { title: "Duplicate", url: "https://example.gov/guide#section", content: "Duplicate result." },
      { title: "Insecure", url: "http://insecure.example/page" },
      { title: "Script", url: "javascript:alert(1)" },
      { title: "Credentials", url: "https://user:pass@example.com/path" },
      { title: "University", url: "https://university.example/research", content: "Research summary." }
    ]
  }, 8);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Official guide");
  assert.equal(results[0].domain, "example.gov");
  assert.equal(results[0].snippet, "A useful snippet.");
  assert.equal(results[0].publishedAt, "2026-10-20T00:00:00.000Z");
});

test("live web search is selected for explicit internet requests and time-sensitive topics", () => {
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

test("search calls only the server-configured endpoint and returns honest snippet fallback", async () => {
  await withEnv({ ...enabledSearch }, async () => {
    let captured;
    const fakeFetch = async (url, options) => {
      captured = { url: new URL(url), options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "300" },
        text: async () => JSON.stringify({
          results: [
            { title: "Official JEE update", url: "https://nta.example/notice", content: "The notice gives current exam information.", engines: ["general"] },
            { title: "University note", url: "https://university.example/jee", content: "A second reference." }
          ]
        })
      };
    };
    const result = await createWebResearch("latest JEE notification", { fetchImpl: fakeFetch });
    assert.equal(captured.url.origin, "http://127.0.0.1:8888");
    assert.equal(captured.url.pathname, "/search");
    assert.equal(captured.url.searchParams.get("format"), "json");
    assert.equal(captured.url.searchParams.get("safesearch"), "2");
    assert.equal(captured.url.searchParams.get("q"), "latest JEE notification");
    assert.equal(captured.options.method, "GET");
    assert.equal(captured.options.redirect, "error");
    assert.equal(result.externalSearch, true);
    assert.equal(result.aiSynthesized, false);
    assert.equal(result.sources.length, 2);
    assert.match(result.answer, /search-result snippets/i);
    assert.deepEqual(result.citations, []);
  });
});

test("search can synthesize a cited answer through the separately configured AI brain", async () => {
  const aiEnv = {
    JARVIS_AI_BASE_URL: "http://127.0.0.1:11434/v1",
    JARVIS_AI_MODEL: "test-model",
    JARVIS_AI_ENABLED: "true",
    JARVIS_AI_CHAT_ENABLED: "true"
  };
  await withEnv({ ...enabledSearch, ...aiEnv }, async () => {
    let sentMessages;
    const fakeFetch = async () => ({
      ok: true, status: 200, headers: { get: () => "200" },
      text: async () => JSON.stringify({ results: [
        { title: "Official release notes", url: "https://official.example/release", content: "A new version was released." }
      ] })
    });
    const fakeAI = async messages => {
      sentMessages = messages;
      return { content: "The official source says a new version was released [1]." };
    };
    const result = await createWebResearch("What is the latest release?", {
      fetchImpl: fakeFetch, aiCompletion: fakeAI
    });
    assert.equal(result.aiSynthesized, true);
    assert.equal(result.citations.length, 1);
    assert.deepEqual(result.citations[0].sourceUrls, ["https://official.example/release"]);
    assert.match(sentMessages[1].content, /untrusted search-result records/i);
  });
});

test("search rejects malformed provider replies and sanitizes provider errors", async () => {
  await withEnv({ ...enabledSearch }, async () => {
    await assert.rejects(
      createWebResearch("latest updates", {
        fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "<html>error</html>" })
      }),
      error => error.code === "WEB_SEARCH_INVALID_RESPONSE"
    );
    await assert.rejects(
      createWebResearch("latest updates", {
        fetchImpl: async () => ({ ok: false, status: 401, text: async () => "secret provider response" })
      }),
      error => error.code === "WEB_SEARCH_REQUEST_ERROR" && !error.message.includes("secret")
    );
  });
});

test("saved research normalizes metadata and accepts only HTTPS source links", () => {
  const saved = normalizeSavedResearch({
    query: "How does solar power work?",
    answer: "Solar panels convert sunlight into electricity.",
    searchedAt: "2026-10-31T00:00:00.000Z",
    sources: [
      { title: "Energy department", url: "https://energy.example/solar", snippet: "Official snippet." },
      { title: "Unsafe source", url: "javascript:alert(1)" },
      { title: "Duplicate", url: "https://energy.example/solar#duplicate" }
    ],
    citations: [
      { claim: "Solar cells convert light into electricity.", sourceUrls: ["https://energy.example/solar", "javascript:alert(1)"] },
      { claim: "Untrusted link", sourceUrls: ["https://not-in-saved-sources.example/article"] }
    ]
  });
  assert.equal(saved.query, "How does solar power work?");
  assert.equal(saved.sources.length, 1);
  assert.equal(saved.sources[0].domain, "energy.example");
  assert.equal(saved.sources[0].snippet, "Official snippet.");
  assert.equal(saved.citations.length, 1);
  assert.deepEqual(saved.citations[0].sourceUrls, ["https://energy.example/solar"]);
  assert.throws(() => normalizeSavedResearch({ query: "", answer: "" }), /needs both/i);
});
