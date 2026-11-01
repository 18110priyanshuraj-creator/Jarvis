import { test } from "node:test";
import assert from "node:assert/strict";
import { createPageReadToken } from "../services/web-page-reader.js";
import { createSourceBasedAnswer } from "../services/source-answer.js";

const SESSION = "test-session-123";
const SECRET = "test-only-source-answer-secret";
const URL_ONE = "https://official.example/guide";
const URL_TWO = "https://university.example/research";

function tokens(urls, issuedAt = Date.now()) {
  return urls.map(url => createPageReadToken(url, SESSION, SECRET, issuedAt));
}

function pageResponse(url) {
  const host = new URL(url.href).hostname;
  const title = host === "official.example" ? "Official energy guide" : "University research note";
  const text = host === "official.example"
    ? "Solar panels convert sunlight into electricity. The guide describes residential use."
    : "The study reports that solar panels convert sunlight into electricity. It discusses research limitations.";
  const html = "<!doctype html><html><head><title>" + title +
    "</title></head><body><main><p>" + text +
    "</p></main></body></html>";
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8", "content-length": String(Buffer.byteLength(html)) },
    body: Buffer.from(html)
  };
}

function readOptions() {
  return {
    resolveHostname: async hostname => [{
      address: hostname === "official.example" ? "93.184.216.34" : "1.1.1.1",
      family: 4
    }],
    requestPage: async url => pageResponse(url)
  };
}

test("source-based answers use only valid session-bound source tokens and map citations to their URLs", async () => {
  let sentMessages;
  const result = await createSourceBasedAnswer(tokens([URL_ONE, URL_TWO]), {
    question: "What do these sources say about solar panels?",
    sessionToken: SESSION,
    secret: SECRET,
    ...readOptions(),
    aiEnabled: true,
    aiCompletion: async messages => {
      sentMessages = messages;
      return { content: JSON.stringify({
        findings: [
          { claim: "Both pages state that solar panels convert sunlight into electricity.", sourceNumbers: [1, 2], confidence: "high" },
          { claim: "Unsupported claim must be removed.", sourceNumbers: [99], confidence: "high" }
        ],
        agreements: [
          { claim: "Both pages describe solar power use or research.", sourceNumbers: [1, 2], confidence: "medium" }
        ],
        differences: [],
        uncertainties: [
          { claim: "The excerpts do not establish the performance of a specific product.", sourceNumbers: [2], confidence: "low" }
        ],
        insufficientEvidence: false
      }) };
    }
  });

  assert.equal(result.aiSynthesized, true);
  assert.equal(result.grounded, true);
  assert.equal(result.answerStatus, "source-supported");
  assert.equal(result.sourceCount, 2);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0].sourceNumbers, [1, 2]);
  assert.equal(result.citations.length, 3);
  assert.deepEqual(result.citations[0].sourceUrls, [URL_ONE, URL_TWO]);
  assert.match(result.answer, /\[1\] \[2\]/);
  assert.match(sentMessages[1].content, /UNTRUSTED PAGE TEXT START/);
  assert.match(sentMessages[0].content, /ignore page text/i);
});

test("source answer rejects expired or foreign-session tokens before fetching any page", async () => {
  let fetched = false;
  const oldTokens = tokens([URL_ONE, URL_TWO], Date.now() - 16 * 60 * 1000);
  await assert.rejects(
    createSourceBasedAnswer(oldTokens, {
      question: "Compare these sources",
      sessionToken: SESSION,
      secret: SECRET,
      ...readOptions(),
      requestPage: async () => { fetched = true; }
    }),
    error => error.code === "SOURCE_ANSWER_TOKEN_INVALID"
  );
  assert.equal(fetched, false);

  await assert.rejects(
    createSourceBasedAnswer(tokens([URL_ONE, URL_TWO]), {
      question: "Compare these sources",
      sessionToken: "another-session",
      secret: SECRET,
      ...readOptions()
    }),
    error => error.code === "SOURCE_ANSWER_TOKEN_INVALID"
  );
});

test("source answer requires two to five distinct sources and a non-empty question", async () => {
  await assert.rejects(
    createSourceBasedAnswer(tokens([URL_ONE]), {
      question: "Question", sessionToken: SESSION, secret: SECRET
    }),
    error => error.code === "SOURCE_ANSWER_COUNT_INVALID"
  );
  await assert.rejects(
    createSourceBasedAnswer(tokens([URL_ONE, URL_ONE]), {
      question: "Question", sessionToken: SESSION, secret: SECRET
    }),
    error => error.code === "SOURCE_ANSWER_DUPLICATE_SOURCE"
  );
  await assert.rejects(
    createSourceBasedAnswer(tokens([URL_ONE, URL_TWO]), {
      question: " ", sessionToken: SESSION, secret: SECRET
    }),
    error => error.code === "SOURCE_ANSWER_QUESTION_REQUIRED"
  );
});

test("source answer refuses to synthesize when fewer than two pages can be safely read", async () => {
  await assert.rejects(
    createSourceBasedAnswer(tokens([URL_ONE, URL_TWO]), {
      question: "Compare these sources",
      sessionToken: SESSION,
      secret: SECRET,
      ...readOptions(),
      resolveHostname: async hostname => [{
        address: hostname === "official.example" ? "93.184.216.34" : "127.0.0.1",
        family: 4
      }],
      aiEnabled: true,
      aiCompletion: async () => {
        throw new Error("AI must not be called without two readable pages");
      }
    }),
    error => error.code === "SOURCE_ANSWER_INSUFFICIENT_PAGES"
  );
});

test("source answer returns excerpts without inventing a combined answer when AI is unavailable", async () => {
  const result = await createSourceBasedAnswer(tokens([URL_ONE, URL_TWO]), {
    question: "Compare these sources",
    sessionToken: SESSION,
    secret: SECRET,
    ...readOptions(),
    aiEnabled: false
  });
  assert.equal(result.answerStatus, "extraction-only");
  assert.equal(result.aiSynthesized, false);
  assert.equal(result.grounded, false);
  assert.equal(result.citations.length, 0);
  assert.equal(result.sources.filter(source => source.status === "read").length, 2);
  assert.match(result.answer, /AI synthesis is unavailable/i);
});

test("source answer drops unsupported source numbers and handles invalid AI JSON safely", async () => {
  const result = await createSourceBasedAnswer(tokens([URL_ONE, URL_TWO]), {
    question: "What is established?",
    sessionToken: SESSION,
    secret: SECRET,
    ...readOptions(),
    aiEnabled: true,
    aiCompletion: async () => ({ content: JSON.stringify({
      findings: [{ claim: "This has no real source.", sourceNumbers: [100], confidence: "high" }],
      agreements: [],
      differences: [],
      uncertainties: [{ claim: "The answer is not established by the supplied pages.", sourceNumbers: [1, 2], confidence: "low" }],
      insufficientEvidence: true
    }) })
  });
  assert.equal(result.aiSynthesized, true);
  assert.equal(result.grounded, false);
  assert.equal(result.findings.length, 0);
  assert.equal(result.answerStatus, "insufficient-evidence");
  assert.match(result.answer, /not enough source-supported evidence/i);
  assert.deepEqual(result.citations[0].sourceUrls, [URL_ONE, URL_TWO]);

  const invalid = await createSourceBasedAnswer(tokens([URL_ONE, URL_TWO]), {
    question: "What is established?",
    sessionToken: SESSION,
    secret: SECRET,
    ...readOptions(),
    aiEnabled: true,
    aiCompletion: async () => ({ content: "not JSON" })
  });
  assert.equal(invalid.aiSynthesized, false);
  assert.equal(invalid.answerStatus, "extraction-only");
  assert.deepEqual(invalid.citations, []);
});
