import crypto from "node:crypto";
import { decryptSecret, encryptSecret, isTokenVaultConfigured } from "./oauth.js";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const CALLBACK_PATH = "/api/integrations/canva/oauth/callback";
export const CANVA_SCOPES = Object.freeze([
  "asset:read",
  "asset:write",
  "design:content:write"
]);
const pendingStates = new Map();
const accessTokens = new Map();
const refreshOperations = new Map();

function clean(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function canvaConfig(env = process.env) {
  const clientId = clean(env.JARVIS_CANVA_OAUTH_CLIENT_ID, 500);
  const clientSecret = clean(env.JARVIS_CANVA_OAUTH_CLIENT_SECRET, 500);
  const redirectUri = clean(env.JARVIS_CANVA_OAUTH_REDIRECT_URI, 1000);
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Canva Connect is not configured. Add the Canva integration Client ID, Client Secret and exact callback URL to the JARVIS server environment.");
  }
  let callback;
  try { callback = new URL(redirectUri); }
  catch { throw new Error("The Canva OAuth callback URL is invalid."); }
  const localHttp = callback.protocol === "http:" && ["localhost", "127.0.0.1"].includes(callback.hostname);
  if ((!localHttp && callback.protocol !== "https:") || callback.username || callback.password ||
      callback.search || callback.hash || callback.pathname !== CALLBACK_PATH) {
    throw new Error("The Canva OAuth callback must be HTTPS and use the exact JARVIS Canva callback path.");
  }
  return { clientId, clientSecret, redirectUri };
}

function normalizeEncryptedToken(value) {
  if (!value || value.version !== 1 || value.algorithm !== "aes-256-gcm" ||
      typeof value.iv !== "string" || typeof value.tag !== "string" ||
      typeof value.ciphertext !== "string" || value.iv.length > 64 ||
      value.tag.length > 64 || value.ciphertext.length > 8192) {
    throw new TypeError("The encrypted Canva credential record is invalid.");
  }
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: value.iv,
    tag: value.tag,
    ciphertext: value.ciphertext
  };
}

export function normalizeCanvaOAuthConnection(input = {}) {
  if (input.provider !== "canva") throw new TypeError("Invalid Canva connection provider.");
  const encryptedRefreshToken = normalizeEncryptedToken(input.encryptedRefreshToken);
  if (!Array.isArray(input.grantedScopes) ||
      CANVA_SCOPES.some((scope) => !input.grantedScopes.includes(scope)) ||
      input.grantedScopes.some((scope) => !CANVA_SCOPES.includes(scope))) {
    throw new TypeError("The Canva connection does not contain the exact supported scopes.");
  }
  const connectedAt = clean(input.connectedAt, 40);
  const updatedAt = clean(input.updatedAt, 40);
  return {
    provider: "canva",
    encryptedRefreshToken,
    grantedScopes: [...new Set(input.grantedScopes)].sort(),
    connectedAt: Number.isFinite(Date.parse(connectedAt)) ? new Date(connectedAt).toISOString() : new Date().toISOString(),
    updatedAt: Number.isFinite(Date.parse(updatedAt)) ? new Date(updatedAt).toISOString() : new Date().toISOString()
  };
}

export function getCanvaOAuthStatus(connection, env = process.env) {
  let configured = false;
  try { canvaConfig(env); configured = true; } catch { /* report configuration state only */ }
  const vaultConfigured = isTokenVaultConfigured(env);
  let connected = false;
  let normalized = null;
  try {
    normalized = connection ? normalizeCanvaOAuthConnection(connection) : null;
    if (normalized && vaultConfigured) {
      decryptSecret(normalized.encryptedRefreshToken, { env, purpose: "canva-refresh-token" });
      connected = true;
    }
  } catch { /* invalid connection or changed encryption key */ }
  return {
    provider: "canva",
    configured,
    vaultConfigured,
    canConnect: configured && vaultConfigured,
    connected,
    grantedScopes: connected ? normalized.grantedScopes : [],
    requiredScopes: [...CANVA_SCOPES],
    callbackPath: CALLBACK_PATH,
    accessBoundary: "Upload user-approved assets and create Canva designs. JARVIS does not receive permission to edit arbitrary existing designs or control the Canva video timeline."
  };
}

function prunePendingStates() {
  const now = Date.now();
  for (const [key, pending] of pendingStates) {
    if (pending.expiresAt <= now) pendingStates.delete(key);
  }
}

function createChallenge(verifier) {
  return hash(verifier).toString("base64url");
}

export async function beginCanvaOAuth(options = {}) {
  const sessionToken = clean(options.sessionToken, 200);
  if (!sessionToken) throw new Error("Sign in to JARVIS before connecting Canva.");
  const env = options.env || process.env;
  const config = canvaConfig(env);
  if (!isTokenVaultConfigured(env)) throw new Error("Encrypted token storage is not configured. Set JARVIS_TOKEN_ENCRYPTION_KEY on the server.");
  prunePendingStates();

  const state = crypto.randomBytes(32).toString("base64url");
  const browserBinding = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const browserBindingHash = hash(browserBinding).toString("base64url");
  const createdAt = Date.now();
  const expiresAt = createdAt + OAUTH_STATE_TTL_MS;
  const authorizationUrl = new URL("https://www.canva.com/api/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", CANVA_SCOPES.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", createChallenge(verifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  const result = { authorizationUrl: authorizationUrl.toString(), browserBinding };
  const pending = {
    sessionHash: hash(sessionToken).toString("base64url"),
    requestedScopes: [...CANVA_SCOPES],
    capability: "canva_connect",
    browserBindingHash,
    encryptedVerifier: encryptSecret(verifier, { env, purpose: "canva-oauth-pkce-verifier" }),
    createdAt,
    expiresAt
  };
  if (options.runtimeStore && typeof options.runtimeStore.savePendingOAuthState === "function") {
    await options.runtimeStore.savePendingOAuthState(hash(state).toString("base64url"), pending);
  } else {
    pendingStates.set(state, {
      ...pending,
      verifier
    });
  }
  return result;
}

async function tokenRequest(body, config, fetchImpl = fetch) {
  const basic = Buffer.from(config.clientId + ":" + config.clientSecret).toString("base64");
  let response;
  try {
    response = await fetchImpl("https://api.canva.com/rest/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + basic,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams(body),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("Canva OAuth timed out. Try connecting again.");
    }
    throw new Error("Could not connect to Canva OAuth.");
  }
  let payload = {};
  try { payload = await response.json(); } catch { /* safe error below */ }
  if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("Canva did not complete authorization. Review the registered integration, redirect URL and requested scopes.");
  }
  return payload;
}

export async function finishCanvaOAuth(options = {}) {
  const state = clean(options.state, 200);
  if (!state) throw new Error("Canva OAuth state is missing.");
  const env = options.env || process.env;
  let pending;
  if (options.runtimeStore && typeof options.runtimeStore.consumePendingOAuthState === "function") {
    pending = await options.runtimeStore.consumePendingOAuthState(hash(state).toString("base64url"));
    if (pending?.encryptedVerifier) {
      try {
        pending.verifier = decryptSecret(pending.encryptedVerifier, { env, purpose: "canva-oauth-pkce-verifier" });
      } catch {
        throw new Error("Canva OAuth state could not be recovered. Start the connection again.");
      }
    }
  } else {
    pending = pendingStates.get(state);
    pendingStates.delete(state);
  }
  if (!pending || pending.capability !== "canva_connect") throw new Error("Canva OAuth state is invalid, expired or already used.");
  if (pending.expiresAt <= Date.now()) throw new Error("Canva OAuth state expired. Start the connection again.");
  const browserHash = hash(clean(options.browserBinding, 200)).toString("base64url");
  if (!timingSafeEqual(browserHash, pending.browserBindingHash)) {
    throw new Error("Canva OAuth browser verification failed. Start the connection again.");
  }
  const sessionReference = pending.sessionToken || pending.sessionHash;
  if (typeof options.isSessionValid !== "function" || !await options.isSessionValid(sessionReference)) {
    throw new Error("Your JARVIS session expired. Sign in and start Canva connection again.");
  }
  if (options.oauthError) throw new Error("Canva authorization was cancelled or denied.");
  const code = clean(options.code, 4000);
  if (!code) throw new Error("Canva did not return an authorization code.");
  const config = canvaConfig(env);
  const tokens = await tokenRequest({
    code,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: pending.verifier
  }, config, options.fetchImpl || fetch);
  const received = typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean).sort() : [...pending.requestedScopes].sort();
  const expected = [...pending.requestedScopes].sort();
  if (received.length !== expected.length || received.some((scope, index) => scope !== expected[index])) {
    throw new Error("Canva did not grant exactly the permissions requested. No connection was saved.");
  }
  let refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
  if (!refreshToken && options.existingConnection) {
    refreshToken = decryptSecret(normalizeCanvaOAuthConnection(options.existingConnection).encryptedRefreshToken, {
      env, purpose: "canva-refresh-token"
    });
  }
  if (!refreshToken) throw new Error("Canva did not return offline refresh access. Reconnect and review the consent screen.");
  const now = new Date().toISOString();
  const connection = normalizeCanvaOAuthConnection({
    provider: "canva",
    encryptedRefreshToken: encryptSecret(refreshToken, { env, purpose: "canva-refresh-token" }),
    grantedScopes: expected,
    connectedAt: now,
    updatedAt: now
  });
  accessTokens.set("canva", { token: tokens.access_token, expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 14400) * 1000 });
  return connection;
}

export async function getCanvaAccessToken(connectionInput, options = {}) {
  const env = options.env || process.env;
  const connection = normalizeCanvaOAuthConnection(connectionInput);
  const cached = accessTokens.get("canva");
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const existing = refreshOperations.get("canva");
  if (existing) return existing;
  const operation = (async () => {
    const config = canvaConfig(env);
    const refreshToken = decryptSecret(connection.encryptedRefreshToken, { env, purpose: "canva-refresh-token" });
    const tokens = await tokenRequest({
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }, config, options.fetchImpl || fetch);
    if (typeof tokens.scope === "string") {
      const refreshed = new Set(tokens.scope.split(/\s+/).filter(Boolean));
      if (connection.grantedScopes.some((scope) => !refreshed.has(scope))) {
        throw new Error("A Canva permission is no longer granted. Reconnect and review the requested access.");
      }
    }
    if (typeof tokens.refresh_token === "string" && tokens.refresh_token) {
      const updated = normalizeCanvaOAuthConnection({
        ...connection,
        encryptedRefreshToken: encryptSecret(tokens.refresh_token, { env, purpose: "canva-refresh-token" }),
        updatedAt: new Date().toISOString()
      });
      if (typeof options.onRefresh === "function") await options.onRefresh(updated);
    }
    accessTokens.set("canva", { token: tokens.access_token, expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 14400) * 1000 });
    return tokens.access_token;
  })();
  refreshOperations.set("canva", operation);
  try { return await operation; }
  finally { refreshOperations.delete("canva"); }
}

async function canvaJson(path, options = {}) {
  const response = await (options.fetchImpl || fetch)("https://api.canva.com/rest/v1" + path, {
    method: options.method || "GET",
    headers: {
      Authorization: "Bearer " + options.accessToken,
      Accept: "application/json",
      ...(options.headers || {})
    },
    body: options.body,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* generic error below */ }
  if (!response.ok) {
    if (response.status === 401) throw new Error("Canva authorization expired. Reconnect Canva and try again.");
    if (response.status === 403) throw new Error("Canva denied this action. Check that the registered integration has the required scopes.");
    if (response.status === 429) throw new Error("Canva rate limit reached. Try again later.");
    throw new Error("Canva could not complete the requested design action (HTTP " + response.status + ").");
  }
  return payload;
}

export async function createCanvaThumbnailDesign(options = {}) {
  const accessToken = clean(options.accessToken, 8192);
  if (accessToken.length < 20) throw new TypeError("A valid Canva access token is required.");
  const bytes = options.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length < 1024 || bytes.length > 4 * 1024 * 1024) {
    throw new TypeError("The thumbnail PNG must be between 1 KB and 4 MB.");
  }
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(pngSignature)) throw new TypeError("The Canva thumbnail must be a valid PNG file.");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== 1280 || height !== 720) throw new TypeError("The Canva thumbnail must be exactly 1280 × 720 pixels.");
  const name = clean(options.name, 50) || "JARVIS YouTube Thumbnail";
  const metadata = { name_base64: Buffer.from(name, "utf8").toString("base64") };
  const upload = await canvaJson("/asset-uploads", {
    method: "POST",
    accessToken,
    fetchImpl: options.fetchImpl,
    headers: {
      "Content-Type": "application/octet-stream",
      "Asset-Upload-Metadata": JSON.stringify(metadata),
      "Content-Length": String(bytes.length)
    },
    body: bytes
  });
  let job = upload.job;
  if (!job?.id) throw new Error("Canva did not return an asset-upload job.");
  for (let attempt = 0; attempt < 4 && job.status === "in_progress"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const result = await canvaJson("/asset-uploads/" + encodeURIComponent(job.id), {
      accessToken,
      fetchImpl: options.fetchImpl
    });
    job = result.job || job;
  }
  if (job.status !== "success" || !job.asset?.id) {
    const message = job.error?.message;
    throw new Error(typeof message === "string" && message.length < 200 ? "Canva asset upload failed: " + message : "Canva asset upload did not complete. Try exporting the PNG again.");
  }
  const design = await canvaJson("/designs", {
    method: "POST",
    accessToken,
    fetchImpl: options.fetchImpl,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "type_and_asset",
      design_type: { type: "custom", width: 1280, height: 720 },
      asset_id: job.asset.id,
      title: name
    })
  });
  const record = design.design;
  if (!record?.id || typeof record.urls?.edit_url !== "string") {
    throw new Error("Canva did not return an editable design link. Check your Canva projects before retrying.");
  }
  const editUrl = new URL(record.urls.edit_url);
  if (editUrl.protocol !== "https:" || editUrl.hostname !== "www.canva.com") {
    throw new Error("Canva returned an unexpected design URL. The link was not shared.");
  }
  return {
    assetId: job.asset.id,
    designId: record.id,
    title: clean(record.title || name, 255),
    editUrl: editUrl.toString(),
    viewUrl: typeof record.urls.view_url === "string" && record.urls.view_url.startsWith("https://www.canva.com/")
      ? record.urls.view_url
      : "",
    note: "The thumbnail is inserted as one flat image. Text and graphic layers are not separately editable through this handoff."
  };
}

export function clearCanvaTokenCache() {
  accessTokens.delete("canva");
}
