import crypto from "node:crypto";

export const ACTION_TTL_MS = 15 * 60 * 1000;
export const MAX_PENDING_ACTIONS = 20;
export const MAX_ACTION_HISTORY = 100;
const REQUEST_TIMEOUT_MS = 12000;
const SECRET_PATTERN = /\b(?:api[_ -]?key|password|passcode|bearer\s+[a-z0-9._-]{8,}|secret\s*[:=]|private key|otp|one.?time password)\b/i;
const TELEGRAM_CHAT_ID_PATTERN = /^-?\d{5,18}$/;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.normalize("NFKC").trim().slice(0, maxLength) : "";
}

function safeContent(value) {
  return !SECRET_PATTERN.test(value);
}

function nowIso() {
  return new Date().toISOString();
}

function parseTelegramAllowlist(env = process.env) {
  return [...new Set(String(env.JARVIS_TELEGRAM_ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => TELEGRAM_CHAT_ID_PATTERN.test(value)))].slice(0, 20);
}

export function getExternalActionCapabilities(options = {}) {
  const env = options.env || process.env;
  const google = options.googleDriveOAuth || {};
  const telegramDisabled = Boolean(options.disabledProviders?.includes("telegram"));
  const googleDisabled = Boolean(options.disabledProviders?.includes("google_drive"));
  const allowedChatIds = parseTelegramAllowlist(env);
  return {
    telegram: {
      configured: Boolean(String(env.JARVIS_TELEGRAM_BOT_TOKEN || "").trim()),
      enabled: Boolean(String(env.JARVIS_TELEGRAM_BOT_TOKEN || "").trim()) && !telegramDisabled,
      allowedChatIds,
      action: "Send a plain text message to an explicitly allow-listed numeric chat ID"
    },
    googleDrive: {
      connected: Boolean(google.connected),
      enabled: Boolean(google.connected) && !googleDisabled,
      canCreateDocs: Boolean(google.connected && google.canCreateDocs) && !googleDisabled,
      docsScope: "https://www.googleapis.com/auth/drive.file",
      action: "Create a new Google Doc owned by the connected account; no sharing or existing-file edits"
    }
  };
}

export function createPendingExternalAction(input = {}, options = {}) {
  const env = options.env || process.env;
  const capabilities = options.capabilities || getExternalActionCapabilities(options);
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ACTION_TTL_MS).toISOString();

  if (input.type === "telegram_send_message") {
    const chatId = cleanText(input.chatId, 24);
    const text = cleanText(input.text, 3000);
    if (!capabilities.telegram?.enabled) throw new Error("Telegram message sending is not enabled. Configure the bot token, enable Telegram and add an allowed chat ID on the server.");
    if (!TELEGRAM_CHAT_ID_PATTERN.test(chatId) || !capabilities.telegram.allowedChatIds?.includes(chatId)) {
      throw new Error("That Telegram chat ID is not in JARVIS_TELEGRAM_ALLOWED_CHAT_IDS. Only allow-listed numeric chat IDs can receive messages.");
    }
    if (!text || !safeContent(text)) throw new Error("Enter a message between 1 and 3,000 characters without passwords, API keys or other secrets.");
    return {
      id,
      provider: "telegram",
      type: "telegram_send_message",
      title: "Send Telegram text message",
      chatId,
      text,
      confirmationPhrase: "SEND MESSAGE",
      status: "pending",
      result: null,
      statusHistory: [{ status: "pending", at: createdAt, summary: "Preview created. Nothing has been sent." }],
      createdAt,
      expiresAt,
      executedAt: ""
    };
  }

  if (input.type === "google_drive_create_doc") {
    const title = cleanText(input.title, 100);
    const content = cleanText(input.content, 12000);
    if (!capabilities.googleDrive?.enabled || !capabilities.googleDrive?.canCreateDocs) {
      throw new Error("Google Docs creation needs an active Google Drive connection with the drive.file permission. Upgrade Google Drive permission from Connections first.");
    }
    if (title.length < 3 || !safeContent(title)) throw new Error("Document title must contain at least 3 characters and no secrets.");
    if (content.length < 1 || !safeContent(content)) throw new Error("Document content cannot be empty or contain password/API-key style secrets.");
    return {
      id,
      provider: "google_drive",
      type: "google_drive_create_doc",
      title: "Create Google Doc",
      documentTitle: title,
      content,
      confirmationPhrase: "CREATE GOOGLE DOC",
      status: "pending",
      result: null,
      statusHistory: [{ status: "pending", at: createdAt, summary: "Document preview created. Nothing has been saved to Drive." }],
      createdAt,
      expiresAt,
      executedAt: ""
    };
  }

  throw new TypeError("Unknown external action type.");
}

export function normalizeExternalAction(input = {}) {
  if (!input || typeof input !== "object" || typeof input.id !== "string") return null;
  const createdAt = cleanText(input.createdAt, 40);
  const expiresAt = cleanText(input.expiresAt, 40);
  const validCreatedAt = Number.isFinite(Date.parse(createdAt));
  const validExpiresAt = Number.isFinite(Date.parse(expiresAt));
  let normalized;
  if (input.type === "telegram_send_message") {
    const chatId = cleanText(input.chatId, 24);
    const text = cleanText(input.text, 3000);
    if (!TELEGRAM_CHAT_ID_PATTERN.test(chatId) || !text || !safeContent(text)) return null;
    normalized = {
      id: input.id.slice(0, 80),
      provider: "telegram",
      type: "telegram_send_message",
      title: "Send Telegram text message",
      chatId,
      text,
      confirmationPhrase: "SEND MESSAGE"
    };
  } else if (input.type === "google_drive_create_doc") {
    const documentTitle = cleanText(input.documentTitle, 100);
    const content = cleanText(input.content, 12000);
    if (documentTitle.length < 3 || !content || !safeContent(documentTitle + "\n" + content)) return null;
    normalized = {
      id: input.id.slice(0, 80),
      provider: "google_drive",
      type: "google_drive_create_doc",
      title: "Create Google Doc",
      documentTitle,
      content,
      confirmationPhrase: "CREATE GOOGLE DOC"
    };
  } else {
    return null;
  }
  const statuses = new Set(["pending", "executing", "completed", "failed", "cancelled", "expired"]);
  let status = statuses.has(input.status) ? input.status : "failed";
  // An interrupted request may already have reached the provider. Never retry it automatically.
  if (status === "executing") status = "failed";
  const history = Array.isArray(input.statusHistory) ? input.statusHistory.slice(-12).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const eventStatus = statuses.has(entry.status) && entry.status !== "executing" ? entry.status : "failed";
    return [{
      status: eventStatus,
      at: Number.isFinite(Date.parse(entry.at)) ? new Date(entry.at).toISOString() : nowIso(),
      summary: cleanText(entry.summary, 240)
    }];
  }) : [];
  return {
    ...normalized,
    status,
    result: input.result && typeof input.result === "object" ? {
      summary: cleanText(input.result.summary, 300),
      messageId: Number.isSafeInteger(input.result.messageId) ? input.result.messageId : null,
      documentId: cleanText(input.result.documentId, 160),
      documentUrl: typeof input.result.documentUrl === "string" && input.result.documentUrl.startsWith("https://docs.google.com/") ? input.result.documentUrl.slice(0, 500) : ""
    } : null,
    statusHistory: history,
    createdAt: validCreatedAt ? new Date(createdAt).toISOString() : nowIso(),
    expiresAt: validExpiresAt ? new Date(expiresAt).toISOString() : nowIso(),
    executedAt: Number.isFinite(Date.parse(input.executedAt)) ? new Date(input.executedAt).toISOString() : ""
  };
}

export function appendActionStatus(action, status, summary, result = null) {
  const next = {
    ...action,
    status,
    result: result ? {
      summary: cleanText(result.summary, 300),
      messageId: Number.isSafeInteger(result.messageId) ? result.messageId : null,
      documentId: cleanText(result.documentId, 160),
      documentUrl: typeof result.documentUrl === "string" && result.documentUrl.startsWith("https://docs.google.com/") ? result.documentUrl.slice(0, 500) : ""
    } : action.result,
    executedAt: ["completed", "failed", "cancelled", "expired"].includes(status) ? nowIso() : action.executedAt,
    statusHistory: [
      ...(Array.isArray(action.statusHistory) ? action.statusHistory : []),
      { status, at: nowIso(), summary: cleanText(summary, 240) }
    ].slice(-12)
  };
  return next;
}

async function postJson(url, headers, payload, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("The external service request timed out. Check the provider before retrying.");
    }
    throw new Error("Could not contact the external service. Check the provider before retrying.");
  }
  let data = {};
  try { data = await response.json(); } catch { /* safe generic failure below */ }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("The external service rejected its configured permission. Review the connection settings.");
    if (response.status === 429) throw new Error("The external service rate limit was reached. Try again later.");
    throw new Error("The external service could not complete this action. Check the provider before retrying.");
  }
  return data;
}

export async function executeTelegramSendMessage(action, options = {}) {
  const env = options.env || process.env;
  const allowed = parseTelegramAllowlist(env);
  if (!allowed.includes(action.chatId)) throw new Error("The Telegram destination is no longer allow-listed. Nothing was sent.");
  const token = String(env.JARVIS_TELEGRAM_BOT_TOKEN || "").trim();
  if (!/^[0-9]{5,16}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("Telegram bot token is missing or invalid. Nothing was sent.");
  const payload = await postJson(
    "https://api.telegram.org/bot" + token + "/sendMessage",
    {},
    { chat_id: action.chatId, text: action.text, link_preview_options: { is_disabled: true } },
    options.fetchImpl || fetch
  );
  if (payload.ok !== true || !Number.isSafeInteger(payload.result?.message_id)) {
    throw new Error("Telegram did not confirm the message. Check the chat before retrying.");
  }
  return {
    summary: "Telegram message sent to the allow-listed chat.",
    messageId: payload.result.message_id
  };
}

async function requestGoogleJson(url, token, payload, fetchImpl) {
  return postJson(url, { Authorization: "Bearer " + token }, payload, fetchImpl);
}

export async function executeGoogleDriveCreateDoc(action, options = {}) {
  const token = await options.getGoogleDriveAccessToken?.();
  if (!token) throw new Error("Google Drive OAuth token is unavailable. Connect the account and grant the drive.file permission.");
  const fetchImpl = options.fetchImpl || fetch;
  const metadata = await requestGoogleJson(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink",
    token,
    { name: action.documentTitle, mimeType: "application/vnd.google-apps.document" },
    fetchImpl
  );
  const documentId = cleanText(metadata.id, 160);
  if (!documentId) throw new Error("Google Drive did not return a document ID.");
  const documentUrl = "https://docs.google.com/document/d/" + encodeURIComponent(documentId) + "/edit";
  try {
    await requestGoogleJson(
      "https://docs.googleapis.com/v1/documents/" + encodeURIComponent(documentId) + ":batchUpdate",
      token,
      { requests: [{ insertText: { location: { index: 1 }, text: action.content } }] },
      fetchImpl
    );
  } catch (error) {
    const partial = new Error("Google created the document but could not add its text. Open the blank document and check it before creating another.");
    partial.partialResult = {
      summary: "A blank Google Doc was created; content insertion needs manual review.",
      documentId,
      documentUrl
    };
    throw partial;
  }
  return {
    summary: "Google Doc created with the approved title and text.",
    documentId,
    documentUrl
  };
}

export async function executeExternalAction(action, options = {}) {
  if (action.type === "telegram_send_message") return executeTelegramSendMessage(action, options);
  if (action.type === "google_drive_create_doc") return executeGoogleDriveCreateDoc(action, options);
  throw new TypeError("Unsupported external action type.");
}
