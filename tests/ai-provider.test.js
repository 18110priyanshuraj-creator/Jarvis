import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatCompletion, getAIProviderStatus } from "../services/ai-provider.js";

const ENV_KEYS = [
  "NODE_ENV", "JARVIS_AI_BASE_URL", "JARVIS_AI_API_KEY", "JARVIS_AI_MODEL", "JARVIS_AI_RUNTIME",
  "JARVIS_AI_ENABLED", "JARVIS_AI_CHAT_ENABLED", "JARVIS_AI_PLANNER_ENABLED",
  "JARVIS_AI_REQUEST_TIMEOUT_MS", "JARVIS_AI_RETRY_ATTEMPTS"
];

for (let index = 1; index <= 7; index++) {
  ENV_KEYS.push(`JARVIS_GEMINI_API_KEY_${index}`, `GEMINI_API_KEY_${index}`);
}
ENV_KEYS.push("JARVIS_GEMINI_API_KEY", "GEMINI_API_KEY");

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

const localConfig = {
  NODE_ENV: "test", JARVIS_AI_BASE_URL: "http://127.0.0.1:11434/v1",
  JARVIS_AI_API_KEY: "", JARVIS_AI_MODEL: "test-model",
  JARVIS_AI_ENABLED: "true", JARVIS_AI_CHAT_ENABLED: "true", JARVIS_AI_PLANNER_ENABLED: "true"
};

test("AI provider stays disabled when endpoint or model configuration is missing", async () => {
  await withEnv({ ...localConfig, JARVIS_AI_BASE_URL: "" }, async () => {
    const status = getAIProviderStatus();
    assert.equal(status.configured, false);
    assert.equal(status.conversationEnabled, false);
    assert.equal(status.plannerEnabled, false);
    assert.equal(status.provider, "openai-compatible");
    assert.equal(status.runtime, "external");
    assert.equal(Object.hasOwn(status, "apiKey"), false);
  });
});

test("remote production endpoints require HTTPS and a private API key", async () => {
  await withEnv({ ...localConfig, NODE_ENV: "production", JARVIS_AI_BASE_URL: "http://model.example/v1", JARVIS_AI_API_KEY: "secret" }, async () => {
    assert.equal(getAIProviderStatus().configured, false);
  });
  await withEnv({ ...localConfig, NODE_ENV: "production", JARVIS_AI_BASE_URL: "https://model.example/v1", JARVIS_AI_API_KEY: "" }, async () => {
    assert.equal(getAIProviderStatus().configured, false);
  });
  await withEnv({ ...localConfig, NODE_ENV: "production", JARVIS_AI_BASE_URL: "https://model.example/v1", JARVIS_AI_API_KEY: "server-secret" }, async () => {
    const status = getAIProviderStatus();
    assert.equal(status.configured, true);
    assert.equal(status.conversationEnabled, true);
    assert.equal(JSON.stringify(status).includes("server-secret"), false);
  });
});

test("self-hosted JARVIS runtime is clearly identified without exposing endpoint credentials", async () => {
  await withEnv({ ...localConfig, JARVIS_AI_RUNTIME: "self-hosted" }, async () => {
    const status = getAIProviderStatus();
    assert.equal(status.runtime, "self-hosted");
    assert.equal(status.provider, "jarvis-self-hosted");
    const result = await createChatCompletion([{ role: "user", content: "Hello" }], {}, async () => ({
      ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Ready." } }] })
    }));
    assert.equal(result.provider, "jarvis-self-hosted");
  });
});

test("AI provider posts standard chat messages without exposing credentials", async () => {
  await withEnv({ ...localConfig, JARVIS_AI_BASE_URL: "https://provider.example/v1", JARVIS_AI_API_KEY: "server-secret" }, async () => {
    let captured;
    const fakeFetch = async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "  Hello from JARVIS.  " } }] }) };
    };
    const result = await createChatCompletion([
      { role: "system", content: "Be helpful." }, { role: "user", content: "Hello" }
    ], { temperature: 0.3, maxTokens: 500 }, fakeFetch);
    assert.equal(result.content, "Hello from JARVIS.");
    assert.equal(result.provider, "openai-compatible");
    assert.equal(captured.url, "https://provider.example/v1/chat/completions");
    assert.equal(captured.options.headers.Authorization, "Bearer server-secret");
    assert.deepEqual(captured.body.messages.map(item => item.role), ["system", "user"]);
    assert.equal(captured.body.stream, false);
  });
});

test("AI provider enables JSON mode for structured Android planning", async () => {
  await withEnv({ ...localConfig }, async () => {
    let body;
    const fakeFetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ mode: "conversation", reply: "Hello", actions: [] }) } }] }) };
    };
    await createChatCompletion([{ role: "user", content: "Hi" }], { responseFormat: { type: "json_object" } }, fakeFetch);
    assert.deepEqual(body.response_format, { type: "json_object" });
  });
});

test("AI provider retries transient HTTP failures but not rejected requests", async () => {
  await withEnv({ ...localConfig, JARVIS_AI_RETRY_ATTEMPTS: "2" }, async () => {
    let count = 0;
    const fakeFetch = async () => {
      count++;
      if (count === 1) return { ok: false, status: 503 };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Recovered." } }] }) };
    };
    const result = await createChatCompletion([{ role: "user", content: "Test" }], {}, fakeFetch);
    assert.equal(result.content, "Recovered.");
    assert.equal(count, 2);
  });
  await withEnv({ ...localConfig, JARVIS_AI_RETRY_ATTEMPTS: "3" }, async () => {
    let count = 0;
    const fakeFetch = async () => { count++; return { ok: false, status: 401 }; };
    await assert.rejects(createChatCompletion([{ role: "user", content: "Test" }], {}, fakeFetch), error => error.code === "AI_PROVIDER_REQUEST_ERROR");
    assert.equal(count, 1);
  });
});

test("AI provider rejects unsupported roles and empty responses", async () => {
  await withEnv({ ...localConfig }, async () => {
    await assert.rejects(createChatCompletion([{ role: "tool", content: "run this" }], {}, async () => ({})), /cannot be empty/i);
    await assert.rejects(
      createChatCompletion([{ role: "user", content: "Hi" }], {}, async () => ({
        ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "" } }] })
      })),
      error => error.code === "AI_PROVIDER_EMPTY_RESPONSE"
    );
  });
});


test("Gemini uses the current stable model and fails over across seven keys without exposing them", async () => {
  const keys = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
    `JARVIS_GEMINI_API_KEY_${index + 1}`, `gemini-secret-${index + 1}`
  ]));
  await withEnv({
    NODE_ENV: "production",
    JARVIS_AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
    JARVIS_AI_MODEL: "gemini-3.8-flash",
    JARVIS_AI_ENABLED: "true",
    JARVIS_AI_CHAT_ENABLED: "true",
    JARVIS_AI_PLANNER_ENABLED: "true",
    ...keys
  }, async () => {
    const status = getAIProviderStatus();
    assert.equal(status.provider, "google-gemini");
    assert.equal(status.model, "gemini-3.8-flash");
    assert.equal(status.configured, true);
    assert.equal(status.keyCount, 7);
    assert.equal(status.failoverEnabled, true);
    assert.equal(JSON.stringify(status).includes("gemini-secret"), false);

    const authHeaders = [];
    let calls = 0;
    const statuses = [429, 403, 401, 503];
    const result = await createChatCompletion([{ role: "user", content: "Hello JARVIS" }], {}, async (url, options) => {
      calls++;
      authHeaders.push(options.headers.Authorization);
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
      assert.equal(options.headers["x-goog-api-client"], "jarvis-personal-assistant/1.0.0");
      const failedStatus = statuses[calls - 1];
      if (failedStatus) return { ok: false, status: failedStatus };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Gemini is ready." } }] }) };
    });
    assert.equal(result.provider, "google-gemini");
    assert.equal(result.model, "gemini-3.8-flash");
    assert.equal(result.content, "Gemini is ready.");
    assert.equal(calls, 5);
    assert.deepEqual(authHeaders, Array.from({ length: 5 }, (_, index) => `Bearer gemini-secret-${index + 1}`));
  });
});

test("Gemini legacy single-key configuration remains supported without claiming seven-key failover", async () => {
  await withEnv({
    NODE_ENV: "production",
    JARVIS_AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
    JARVIS_AI_MODEL: "gemini-3.8-flash",
    JARVIS_AI_ENABLED: "true",
    GEMINI_API_KEY: "legacy-gemini-secret"
  }, async () => {
    const status = getAIProviderStatus();
    assert.equal(status.configured, true);
    assert.equal(status.keyCount, 1);
    assert.equal(status.failoverEnabled, false);
    let authorization;
    await createChatCompletion([{ role: "user", content: "Test" }], {}, async (_url, options) => {
      authorization = options.headers.Authorization;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "OK" } }] }) };
    });
    assert.equal(authorization, "Bearer legacy-gemini-secret");
  });
});

test("Gemini stops on invalid request instead of wasting the remaining keys", async () => {
  await withEnv({
    NODE_ENV: "production",
    JARVIS_AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
    JARVIS_AI_MODEL: "gemini-3.8-flash",
    JARVIS_AI_ENABLED: "true",
    ...Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
      `JARVIS_GEMINI_API_KEY_${index + 1}`, `gemini-secret-${index + 1}`
    ]))
  }, async () => {
    let calls = 0;
    await assert.rejects(
      createChatCompletion([{ role: "user", content: "Test" }], {}, async () => {
        calls++;
        return { ok: false, status: 400 };
      }),
      error => error.code === "AI_PROVIDER_REQUEST_ERROR"
    );
    assert.equal(calls, 1);
  });
});


test("AI provider forwards only bounded inline image frames with user consent", async () => {
  await withEnv({ ...localConfig }, async () => {
    const frame = "data:image/jpeg;base64," + "A".repeat(300);
    let captured;
    await createChatCompletion([
      { role: "system", content: "Review the provided frames." },
      { role: "user", content: [
        { type: "text", text: "Review this video sample." },
        { type: "image_url", image_url: { url: frame, detail: "low" } }
      ] }
    ], {}, async (_url, options) => {
      captured = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Reviewed." } }] }) };
    });
    assert.equal(captured.messages[1].content[1].image_url.url, frame);
    assert.equal(captured.messages[1].content[1].image_url.detail, "low");
  });
});

test("AI provider rejects remote image URLs and oversized frame payloads", async () => {
  await withEnv({ ...localConfig }, async () => {
    const remote = [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/frame.jpg" } }] }];
    await assert.rejects(createChatCompletion(remote, {}, async () => ({})), /base64 JPEG/i);
    const oversized = "data:image/jpeg;base64," + "A".repeat(180001);
    await assert.rejects(
      createChatCompletion([{ role: "user", content: [{ type: "image_url", image_url: { url: oversized } }] }], {}, async () => ({})),
      /base64 JPEG/i
    );
  });
});
