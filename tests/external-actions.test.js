import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendActionStatus,
  createPendingExternalAction,
  executeExternalAction,
  getExternalActionCapabilities,
  normalizeExternalAction
} from "../services/external-actions.js";

const telegramEnv = {
  JARVIS_TELEGRAM_BOT_TOKEN: "123456789:" + "A".repeat(32),
  JARVIS_TELEGRAM_ALLOWED_CHAT_IDS: "123456789,-1001234567890"
};

function telegramCapabilities() {
  return getExternalActionCapabilities({
    env: telegramEnv,
    googleDriveOAuth: { connected: false, canCreateDocs: false },
    disabledProviders: []
  });
}

function googleCapabilities() {
  return getExternalActionCapabilities({
    env: {},
    googleDriveOAuth: { connected: true, canCreateDocs: true },
    disabledProviders: []
  });
}

test("Telegram preview accepts only allow-listed numeric destinations", () => {
  const action = createPendingExternalAction({
    type: "telegram_send_message",
    chatId: "123456789",
    text: "Hello from my JARVIS preview."
  }, { env: telegramEnv, capabilities: telegramCapabilities() });
  assert.equal(action.status, "pending");
  assert.equal(action.confirmationPhrase, "SEND MESSAGE");
  assert.equal(action.chatId, "123456789");
  assert.ok(Date.parse(action.expiresAt) > Date.now());
  assert.equal(JSON.stringify(action).includes(telegramEnv.JARVIS_TELEGRAM_BOT_TOKEN), false);
});

test("Telegram preview rejects destinations outside the configured allow-list", () => {
  assert.throws(() => createPendingExternalAction({
    type: "telegram_send_message",
    chatId: "999999999",
    text: "Message should not be queued."
  }, { env: telegramEnv, capabilities: telegramCapabilities() }), /not in JARVIS_TELEGRAM_ALLOWED_CHAT_IDS/);
});

test("Telegram preview refuses non-numeric public handles and secret-like content", () => {
  assert.throws(() => createPendingExternalAction({
    type: "telegram_send_message",
    chatId: "@public_channel",
    text: "Hello"
  }, { env: telegramEnv, capabilities: telegramCapabilities() }), /numeric chat ID/);
  assert.throws(() => createPendingExternalAction({
    type: "telegram_send_message",
    chatId: "123456789",
    text: "Here is my API key: secret"
  }, { env: telegramEnv, capabilities: telegramCapabilities() }), /without passwords, API keys/);
});

test("Telegram preview cannot be created when the provider is disabled", () => {
  const capabilities = getExternalActionCapabilities({
    env: telegramEnv,
    googleDriveOAuth: {},
    disabledProviders: ["telegram"]
  });
  assert.throws(() => createPendingExternalAction({
    type: "telegram_send_message",
    chatId: "123456789",
    text: "Hello"
  }, { env: telegramEnv, capabilities }), /not enabled/);
});

test("Telegram execution sends only the selected chat and plain text after approval", async () => {
  const action = createPendingExternalAction({
    type: "telegram_send_message",
    chatId: "123456789",
    text: "This exact message is approved."
  }, { env: telegramEnv, capabilities: telegramCapabilities() });
  let captured = null;
  const result = await executeExternalAction(action, {
    env: telegramEnv,
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.ok(captured.url.endsWith("/sendMessage"));
  assert.ok(captured.url.includes(telegramEnv.JARVIS_TELEGRAM_BOT_TOKEN));
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.redirect, "error");
  assert.deepEqual(captured.body, {
    chat_id: "123456789",
    text: "This exact message is approved.",
    link_preview_options: { is_disabled: true }
  });
  assert.equal(result.messageId, 42);
  assert.equal(JSON.stringify(result).includes(telegramEnv.JARVIS_TELEGRAM_BOT_TOKEN), false);
});

test("Telegram execution rechecks the server allow-list immediately before sending", async () => {
  const action = createPendingExternalAction({
    type: "telegram_send_message",
    chatId: "123456789",
    text: "Hello"
  }, { env: telegramEnv, capabilities: telegramCapabilities() });
  let calls = 0;
  await assert.rejects(() => executeExternalAction(action, {
    env: { ...telegramEnv, JARVIS_TELEGRAM_ALLOWED_CHAT_IDS: "987654321" },
    fetchImpl: async () => { calls += 1; }
  }), /no longer allow-listed/);
  assert.equal(calls, 0);
});

test("Google Docs previews require the separate drive.file capability", () => {
  const action = createPendingExternalAction({
    type: "google_drive_create_doc",
    title: "JEE revision notes",
    content: "Physics revision notes and worked examples."
  }, { capabilities: googleCapabilities() });
  assert.equal(action.confirmationPhrase, "CREATE GOOGLE DOC");
  assert.equal(action.status, "pending");
  assert.equal(action.documentTitle, "JEE revision notes");
  const readOnly = getExternalActionCapabilities({
    env: {},
    googleDriveOAuth: { connected: true, canCreateDocs: false },
    disabledProviders: []
  });
  assert.throws(() => createPendingExternalAction({
    type: "google_drive_create_doc",
    title: "JEE revision notes",
    content: "Physics revision notes."
  }, { capabilities: readOnly }), /drive.file permission/);
});

test("Google Docs execution creates a new app-owned file then inserts its approved text", async () => {
  const action = createPendingExternalAction({
    type: "google_drive_create_doc",
    title: "Physics revision",
    content: "Chapter 1: units and measurements."
  }, { capabilities: googleCapabilities() });
  const calls = [];
  const result = await executeExternalAction(action, {
    getGoogleDriveAccessToken: async () => "short-lived-access-token",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options, body: JSON.parse(options.body) });
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          id: "document-123",
          name: "Physics revision",
          mimeType: "application/vnd.google-apps.document"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ documentId: "document-123", replies: [{}] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink");
  assert.equal(calls[0].body.name, "Physics revision");
  assert.equal(calls[0].body.mimeType, "application/vnd.google-apps.document");
  assert.ok(calls[1].url.endsWith("/documents/document-123:batchUpdate"));
  assert.deepEqual(calls[1].body.requests, [{
    insertText: { location: { index: 1 }, text: "Chapter 1: units and measurements." }
  }]);
  assert.equal(result.documentUrl, "https://docs.google.com/document/d/document-123/edit");
});

test("Google Docs reports a partial result if the file exists but content insertion fails", async () => {
  const action = createPendingExternalAction({
    type: "google_drive_create_doc",
    title: "Physics revision",
    content: "Chapter 1 notes."
  }, { capabilities: googleCapabilities() });
  let calls = 0;
  await assert.rejects(() => executeExternalAction(action, {
    getGoogleDriveAccessToken: async () => "short-lived-access-token",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ id: "document-456" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ error: "internalError", description: "provider private detail" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
  }), (error) => {
    assert.equal(error.partialResult.documentId, "document-456");
    assert.ok(error.partialResult.documentUrl.includes("document-456"));
    assert.equal(error.message.includes("provider private detail"), false);
    return true;
  });
});

test("Action status history is bounded and executing actions are never automatically retried after restart", () => {
  let action = createPendingExternalAction({
    type: "telegram_send_message",
    chatId: "123456789",
    text: "One-time action."
  }, { env: telegramEnv, capabilities: telegramCapabilities() });
  action = appendActionStatus(action, "executing", "Provider request started.");
  const restored = normalizeExternalAction(action);
  assert.equal(restored.status, "failed");
  assert.ok(restored.statusHistory.some((event) => event.status === "failed"));
  assert.equal(restored.confirmationPhrase, "SEND MESSAGE");
  assert.equal(restored.statusHistory.length <= 12, true);
});

test("Completed and cancelled previews cannot be executed a second time by their state", () => {
  const action = createPendingExternalAction({
    type: "telegram_send_message",
    chatId: "123456789",
    text: "Only send once."
  }, { env: telegramEnv, capabilities: telegramCapabilities() });
  const completed = appendActionStatus(action, "completed", "Sent.", { messageId: 7 });
  const cancelled = appendActionStatus(action, "cancelled", "Cancelled.");
  assert.equal(normalizeExternalAction(completed).status, "completed");
  assert.equal(normalizeExternalAction(cancelled).status, "cancelled");
});
