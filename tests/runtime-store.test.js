import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntimeStore, RUNTIME_CHAT_LIMIT, RUNTIME_CHAT_TTL_MS } from "../services/runtime-store.js";

const HOUR = 60 * 60 * 1000;

test("in-memory runtime sessions expire and can be explicitly removed", async () => {
  let now = 1_000_000;
  const runtime = createRuntimeStore({ now: () => now });

  await runtime.createSession("opaque-session-token", HOUR);
  assert.equal(await runtime.refreshSession("opaque-session-token", HOUR), true);
  now += HOUR + 1;
  assert.equal(await runtime.refreshSession("opaque-session-token", HOUR), false);

  await runtime.createSession("second-session-token", HOUR);
  assert.equal(await runtime.refreshSessionByHash(runtime.hashIdentifier("second-session-token"), HOUR), true);
  await runtime.deleteSession("second-session-token");
  assert.equal(await runtime.refreshSession("second-session-token", HOUR), false);
});

test("temporary chat is bounded, refreshed on access, and removed on request", async () => {
  let now = 2_000_000;
  const runtime = createRuntimeStore({ now: () => now });

  for (let i = 0; i < 20; i += 1) {
    await runtime.appendConversationTurn("session:alpha", "question " + i, {
      answer: "answer " + i,
      engine: "test-engine",
      sources: [],
      citations: []
    });
  }

  const recent = await runtime.getConversationMessages("session:alpha");
  assert.equal(recent.length, RUNTIME_CHAT_LIMIT);
  assert.equal(recent[0].content, "question 4");
  assert.equal(recent.at(-1).content, "answer 19");

  now += RUNTIME_CHAT_TTL_MS - 1;
  assert.equal((await runtime.getConversationMessages("session:alpha")).length, RUNTIME_CHAT_LIMIT);
  await runtime.deleteConversationMessages("session:alpha");
  assert.deepEqual(await runtime.getConversationMessages("session:alpha"), []);
});

test("in-memory OAuth state is consumed once and expires", async () => {
  let now = 3_000_000;
  const runtime = createRuntimeStore({ now: () => now });
  const record = {
    sessionHash: runtime.hashIdentifier("session-token"),
    browserBindingHash: "browser-binding-hash",
    requestedScopes: ["scope.read"],
    capability: "read",
    encryptedVerifier: { version: 1, algorithm: "aes-256-gcm" },
    createdAt: now,
    expiresAt: now + 500
  };

  await runtime.savePendingOAuthState("state-hash", record);
  assert.deepEqual(await runtime.consumePendingOAuthState("state-hash"), record);
  assert.equal(await runtime.consumePendingOAuthState("state-hash"), null);

  await runtime.savePendingOAuthState("expired-state", { ...record, expiresAt: now + 10 });
  now += 11;
  assert.equal(await runtime.consumePendingOAuthState("expired-state"), null);
});

test("Neon mode creates shared tables and uses hashed session and chat identifiers", async () => {
  const calls = [];
  const fakeSql = async (strings, ...values) => {
    const statement = strings.join("?");
    calls.push({ statement, values });
    if (statement.includes("UPDATE jarvis_sessions")) {
      return [{ created_at: new Date(10_000).toISOString(), expires_at: new Date(20_000).toISOString() }];
    }
    if (statement.includes("SELECT id, role, content")) {
      return [{
        id: 7,
        role: "assistant",
        content: "stored reply",
        engine: "gemini-conversation",
        sources: [{ title: "source" }],
        citations: [],
        created_at: new Date(12_000).toISOString()
      }];
    }
    if (statement.includes("DELETE FROM jarvis_oauth_pending") && statement.includes("RETURNING")) {
      return [{
        session_hash: "session-hash",
        browser_binding_hash: "browser-hash",
        requested_scopes: ["scope.read"],
        capability: "read",
        encrypted_verifier: { version: 1, algorithm: "aes-256-gcm" },
        created_at: new Date(10_000).toISOString(),
        expires_at: new Date(20_000).toISOString()
      }];
    }
    return [];
  };
  fakeSql.transaction = async (queries) => Promise.all(queries);
  const runtime = createRuntimeStore({ getSql: () => fakeSql, now: () => 15_000 });

  await runtime.ensureTables();
  await runtime.createSession("opaque-token", HOUR);
  assert.equal(await runtime.refreshSession("opaque-token", HOUR), true);
  assert.equal(await runtime.refreshSessionByHash(runtime.hashIdentifier("opaque-token"), HOUR), true);

  const messages = await runtime.getConversationMessages("private-conversation-key");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, "stored reply");
  await runtime.appendConversationTurn("private-conversation-key", "question", { answer: "reply" });

  const pending = {
    sessionHash: "session-hash",
    browserBindingHash: "browser-hash",
    requestedScopes: ["scope.read"],
    capability: "read",
    encryptedVerifier: { version: 1, algorithm: "aes-256-gcm" },
    createdAt: 10_000,
    expiresAt: 20_000
  };
  await runtime.savePendingOAuthState("state-hash", pending);
  const consumed = await runtime.consumePendingOAuthState("state-hash");
  assert.equal(consumed.sessionHash, "session-hash");

  assert.equal(calls.some((item) => item.statement.includes("CREATE TABLE IF NOT EXISTS jarvis_sessions")), true);
  assert.equal(calls.some((item) => item.statement.includes("CREATE TABLE IF NOT EXISTS jarvis_chat_messages")), true);
  assert.equal(calls.some((item) => item.statement.includes("CREATE TABLE IF NOT EXISTS jarvis_oauth_pending")), true);
  const sessionInsert = calls.find((item) => item.statement.includes("INSERT INTO jarvis_sessions"));
  assert.ok(sessionInsert);
  assert.equal(sessionInsert.values.includes("opaque-token"), false);
  const chatRead = calls.find((item) => item.statement.includes("SELECT id, role, content"));
  assert.ok(chatRead.values.includes(runtime.hashIdentifier("private-conversation-key")));
});
