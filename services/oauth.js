import crypto from "node:crypto";

export const GOOGLE_DRIVE_METADATA_SCOPE =
  "https://www.googleapis.com/auth/drive.metadata.readonly";
export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";
export const YOUTUBE_UPLOAD_SCOPE =
  "https://www.googleapis.com/auth/youtube.upload";
const GOOGLE_CALLBACK_PATH = "/api/integrations/google_drive/oauth/callback";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 8000;
const pendingStates = new Map();
const pendingBrowserHandoffs = new Map();
const OAUTH_BROWSER_HANDOFF_TTL_MS = 2 * 60 * 1000;
const MAX_PENDING_BROWSER_HANDOFFS = 100;
const accessTokenCache = new Map();
const refreshOperations = new Map();

function cleanString(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function timingSafeStringEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function getEncryptionKey(env = process.env) {
  const raw = cleanString(env.JARVIS_TOKEN_ENCRYPTION_KEY, 256);
  if (!raw) throw new Error("Encrypted token storage is not configured. Set JARVIS_TOKEN_ENCRYPTION_KEY on the server.");
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    key = Buffer.from(raw, "base64");
  } else {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32) {
    throw new Error("JARVIS_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

export function isTokenVaultConfigured(env = process.env) {
  try { getEncryptionKey(env); return true; } catch { return false; }
}

export function encryptSecret(value, options = {}) {
  if (typeof value !== "string" || value.length < 1) throw new TypeError("A non-empty secret is required.");
  const env = options.env || process.env;
  const purpose = cleanString(options.purpose, 80) || "jarvis-token-v1";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(env), iv);
  cipher.setAAD(Buffer.from("JARVIS:" + purpose + ":v1"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}

export function decryptSecret(record, options = {}) {
  const env = options.env || process.env;
  const purpose = cleanString(options.purpose, 80) || "jarvis-token-v1";
  if (!record || record.version !== 1 || record.algorithm !== "aes-256-gcm" ||
      typeof record.iv !== "string" || typeof record.tag !== "string" ||
      typeof record.ciphertext !== "string") {
    throw new Error("The encrypted credential record is invalid.");
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(env), Buffer.from(record.iv, "base64url"));
    decipher.setAAD(Buffer.from("JARVIS:" + purpose + ":v1"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("The stored Google Drive credential could not be decrypted. Check the encryption key configured on the server.");
  }
}

export function normalizeGoogleOAuthConnection(input = {}) {
  const encrypted = input.encryptedRefreshToken;
  if (input.provider !== "google_drive" ||
      !encrypted || encrypted.version !== 1 ||
      encrypted.algorithm !== "aes-256-gcm" ||
      typeof encrypted.iv !== "string" ||
      typeof encrypted.tag !== "string" ||
      typeof encrypted.ciphertext !== "string" ||
      !Array.isArray(input.grantedScopes) ||
      !input.grantedScopes.includes(GOOGLE_DRIVE_METADATA_SCOPE) ||
      input.grantedScopes.some((scope) => ![GOOGLE_DRIVE_METADATA_SCOPE, GOOGLE_DRIVE_FILE_SCOPE, YOUTUBE_UPLOAD_SCOPE].includes(scope))) {
    throw new TypeError("Invalid encrypted Google Drive connection record.");
  }
  const connectedAt = cleanString(input.connectedAt, 40);
  const updatedAt = cleanString(input.updatedAt, 40);
  return {
    provider: "google_drive",
    encryptedRefreshToken: {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: encrypted.iv.slice(0, 64),
      tag: encrypted.tag.slice(0, 64),
      ciphertext: encrypted.ciphertext.slice(0, 8192)
    },
    grantedScopes: [...new Set(input.grantedScopes)],
    connectedAt: Number.isFinite(Date.parse(connectedAt)) ? new Date(connectedAt).toISOString() : new Date().toISOString(),
    updatedAt: Number.isFinite(Date.parse(updatedAt)) ? new Date(updatedAt).toISOString() : new Date().toISOString()
  };
}

function getGoogleConfig(env = process.env) {
  const clientId = cleanString(env.JARVIS_GOOGLE_OAUTH_CLIENT_ID, 500);
  const clientSecret = cleanString(env.JARVIS_GOOGLE_OAUTH_CLIENT_SECRET, 500);
  const redirectUri = cleanString(env.JARVIS_GOOGLE_OAUTH_REDIRECT_URI, 1000);
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth is not configured. Set the Google OAuth client ID, client secret and exact callback URL in the server environment.");
  }
  let callback;
  try { callback = new URL(redirectUri); } catch {
    throw new Error("The Google OAuth callback URL is invalid.");
  }
  const localHttp = callback.protocol === "http:" && ["localhost", "127.0.0.1"].includes(callback.hostname);
  if ((!localHttp && callback.protocol !== "https:") ||
      callback.username || callback.password || callback.search || callback.hash ||
      callback.pathname !== GOOGLE_CALLBACK_PATH) {
    throw new Error("The Google OAuth callback must be HTTPS and use the exact JARVIS callback path.");
  }
  return { clientId, clientSecret, redirectUri };
}

export function getGoogleOAuthStatus(connection, env = process.env) {
  let oauthClientConfigured = false;
  try { getGoogleConfig(env); oauthClientConfigured = true; } catch { /* report status only */ }
  const vaultConfigured = isTokenVaultConfigured(env);
  let normalized = null;
  let credentialHealthy = false;
  try {
    normalized = connection ? normalizeGoogleOAuthConnection(connection) : null;
    if (normalized && vaultConfigured) {
      decryptSecret(normalized.encryptedRefreshToken, { env, purpose: "google-drive-refresh-token" });
      credentialHealthy = true;
    }
  } catch { /* invalid record or the configured key does not match */ }
  return {
    provider: "google_drive",
    connected: credentialHealthy,
    oauthClientConfigured,
    vaultConfigured,
    canConnect: oauthClientConfigured && vaultConfigured,
    requiredScopes: [GOOGLE_DRIVE_METADATA_SCOPE],
    docsScope: GOOGLE_DRIVE_FILE_SCOPE,
    canCreateDocs: credentialHealthy && normalized.grantedScopes.includes(GOOGLE_DRIVE_FILE_SCOPE),
    youtubeUploadScope: YOUTUBE_UPLOAD_SCOPE,
    canUploadYouTube: credentialHealthy && normalized.grantedScopes.includes(YOUTUBE_UPLOAD_SCOPE),
    grantedScopes: credentialHealthy ? normalized.grantedScopes : [],
    connectedAt: credentialHealthy ? normalized.connectedAt : null,
    redirectPath: GOOGLE_CALLBACK_PATH,
    tokenStorage: "AES-256-GCM encrypted refresh token; access tokens held in process memory"
  };
}

function prunePendingStates() {
  const now = Date.now();
  for (const [state, pending] of pendingStates) {
    if (pending.expiresAt <= now) pendingStates.delete(state);
  }
  for (const [ticketHash, handoff] of pendingBrowserHandoffs) {
    if (handoff.expiresAt <= now) pendingBrowserHandoffs.delete(ticketHash);
  }
}

export function beginGoogleOAuth({ sessionToken, capability = "read", existingConnection = null, env = process.env, runtimeStore = null }) {
  if (!cleanString(sessionToken, 200)) throw new Error("Sign in to JARVIS before connecting Google Drive.");
  if (!["read", "create_docs", "youtube_upload"].includes(capability)) throw new TypeError("Unsupported Google permission capability.");
  getEncryptionKey(env);
  const config = getGoogleConfig(env);
  prunePendingStates();
  const capabilityScopes = capability === "create_docs"
    ? [GOOGLE_DRIVE_METADATA_SCOPE, GOOGLE_DRIVE_FILE_SCOPE]
    : capability === "youtube_upload"
      ? [GOOGLE_DRIVE_METADATA_SCOPE, YOUTUBE_UPLOAD_SCOPE]
      : [GOOGLE_DRIVE_METADATA_SCOPE];
  const previousScopes = existingConnection ? normalizeGoogleOAuthConnection(existingConnection).grantedScopes : [];
  const requestedScopes = [...new Set([...previousScopes, ...capabilityScopes])].sort();

  const state = crypto.randomBytes(32).toString("base64url");
  const browserBinding = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = hash(verifier).toString("base64url");
  const createdAt = Date.now();
  const expiresAt = createdAt + OAUTH_STATE_TTL_MS;
  const browserBindingHash = hash(browserBinding).toString("base64url");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", requestedScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const result = { authorizationUrl: url.toString(), browserBinding };
  if (runtimeStore && typeof runtimeStore.savePendingOAuthState === "function") {
    const sessionHash = hash(sessionToken).toString("base64url");
    const pending = {
      sessionHash,
      requestedScopes,
      capability,
      browserBindingHash,
      encryptedVerifier: encryptSecret(verifier, { env, purpose: "google-oauth-pkce-verifier" }),
      createdAt,
      expiresAt
    };
    const saved = runtimeStore.savePendingOAuthState(hash(state).toString("base64url"), pending);
    return saved && typeof saved.then === "function" ? saved.then(() => result) : result;
  }

  pendingStates.set(state, {
    sessionToken,
    requestedScopes,
    capability,
    browserBindingHash,
    verifier,
    createdAt,
    expiresAt
  });
  return result;
}

async function readTokenResponse(response) {
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      throw new Error("Google rejected the OAuth exchange. Reconnect Google Drive and review the consent screen.");
    }
    throw new Error("Google OAuth is temporarily unavailable. Try again later.");
  }
  let data;
  try { data = await response.json(); } catch {
    throw new Error("Google returned an unreadable OAuth response.");
  }
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Google did not return an access token.");
  }
  return data;
}

async function postGoogleToken(body, fetchImpl) {
  let response;
  try {
    response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body),
      redirect: "error",
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("Google OAuth request timed out. Try again later.");
    }
    throw new Error("Could not connect to Google's OAuth service.");
  }
  return readTokenResponse(response);
}

function cacheAccessToken(token, expiresIn) {
  accessTokenCache.set("google_drive", {
    token,
    expiresAt: Date.now() + Math.max(60, Number(expiresIn) || 3600) * 1000
  });
}

/**
 * Creates a short-lived one-use launch URL for the system browser.
 * The browser-binding value remains server-side until the ticket is redeemed,
 * where it is set as an HttpOnly callback cookie before redirecting to Google.
 */
export function createGoogleOAuthBrowserHandoff({ authorizationUrl, browserBinding }) {
  const authUrl = (() => {
    try { return new URL(cleanString(authorizationUrl, 4096)); } catch { return null; }
  })();
  if (!authUrl ||
      authUrl.origin !== "https://accounts.google.com" ||
      authUrl.pathname !== "/o/oauth2/v2/auth" ||
      !cleanString(browserBinding, 200)) {
    throw new Error("Google OAuth browser handoff could not be created.");
  }

  let callback;
  try { callback = new URL(authUrl.searchParams.get("redirect_uri") || ""); } catch {
    throw new Error("Google OAuth callback URL is invalid.");
  }
  const localHttp = callback.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(callback.hostname);
  if ((!localHttp && callback.protocol !== "https:") ||
      callback.username || callback.password || callback.search || callback.hash ||
      callback.pathname !== GOOGLE_CALLBACK_PATH) {
    throw new Error("Google OAuth callback URL is invalid.");
  }

  prunePendingStates();
  while (pendingBrowserHandoffs.size >= MAX_PENDING_BROWSER_HANDOFFS) {
    const oldestTicketHash = pendingBrowserHandoffs.keys().next().value;
    if (!oldestTicketHash) break;
    pendingBrowserHandoffs.delete(oldestTicketHash);
  }

  const ticket = crypto.randomBytes(32).toString("base64url");
  const ticketHash = hash(ticket).toString("base64url");
  pendingBrowserHandoffs.set(ticketHash, {
    authorizationUrl: authUrl.toString(),
    browserBinding: cleanString(browserBinding, 200),
    expiresAt: Date.now() + OAUTH_BROWSER_HANDOFF_TTL_MS
  });

  const launchUrl = new URL("/api/integrations/google_drive/oauth/launch", callback.origin);
  launchUrl.searchParams.set("ticket", ticket);
  return launchUrl.toString();
}

/** Consumes a browser launch ticket once. Only a hash of the ticket is stored. */
export function consumeGoogleOAuthBrowserHandoff(ticket) {
  const value = cleanString(ticket, 128);
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(value)) return null;
  const ticketHash = hash(value).toString("base64url");
  const handoff = pendingBrowserHandoffs.get(ticketHash);
  pendingBrowserHandoffs.delete(ticketHash);
  if (!handoff || handoff.expiresAt <= Date.now()) return null;
  return {
    authorizationUrl: handoff.authorizationUrl,
    browserBinding: handoff.browserBinding
  };
}

export async function finishGoogleOAuth(options = {}) {
  const state = cleanString(options.state, 200);
  let pending = null;
  if (options.runtimeStore && typeof options.runtimeStore.consumePendingOAuthState === "function") {
    pending = await options.runtimeStore.consumePendingOAuthState(hash(state).toString("base64url"));
    if (pending?.encryptedVerifier) {
      try {
        pending.verifier = decryptSecret(pending.encryptedVerifier, {
          env: options.env || process.env,
          purpose: "google-oauth-pkce-verifier"
        });
      } catch {
        throw new Error("Google OAuth state could not be recovered. Start the connection again.");
      }
    }
  } else {
    pending = pendingStates.get(state);
    pendingStates.delete(state);
  }
  if (!pending) throw new Error("Google OAuth state is invalid, expired, or already used.");
  if (pending.expiresAt <= Date.now()) {
    throw new Error("Google OAuth state expired. Start the connection again.");
  }

  const browserHash = hash(cleanString(options.browserBinding, 200)).toString("base64url");
  if (!timingSafeStringEqual(browserHash, pending.browserBindingHash)) {
    throw new Error("Google OAuth browser verification failed. Start the connection again.");
  }
  const sessionReference = pending.sessionToken || pending.sessionHash;
  if (typeof options.isSessionValid !== "function" || !await options.isSessionValid(sessionReference)) {
    throw new Error("Your JARVIS session expired. Sign in and start the Google connection again.");
  }
  if (options.oauthError) throw new Error("Google Drive authorization was cancelled or denied.");
  const code = cleanString(options.code, 4000);
  if (!code) throw new Error("Google did not return an authorization code.");

  const env = options.env || process.env;
  const config = getGoogleConfig(env);
  const fetchImpl = options.fetchImpl || fetch;
  const tokens = await postGoogleToken({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: pending.verifier
  }, fetchImpl);

  const scopes = typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : [];
  const grantedRequestedScopes = [...new Set(scopes)].sort();
  const expectedRequestedScopes = [...pending.requestedScopes].sort();
  if (grantedRequestedScopes.length !== expectedRequestedScopes.length ||
      grantedRequestedScopes.some((scope, index) => scope !== expectedRequestedScopes[index])) {
    throw new Error("Google did not grant exactly the permissions requested for this action. No connection was saved.");
  }
  let refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : "";
  if (!refreshToken && options.existingConnection) {
    refreshToken = decryptSecret(options.existingConnection.encryptedRefreshToken, {
      env,
      purpose: "google-drive-refresh-token"
    });
  }
  if (!refreshToken) {
    throw new Error("Google did not return offline refresh permission. Reconnect and approve the requested offline access.");
  }

  const now = new Date().toISOString();
  const connection = normalizeGoogleOAuthConnection({
    provider: "google_drive",
    encryptedRefreshToken: encryptSecret(refreshToken, { env, purpose: "google-drive-refresh-token" }),
    grantedScopes: pending.requestedScopes,
    connectedAt: now,
    updatedAt: now
  });
  cacheAccessToken(tokens.access_token, tokens.expires_in);
  return connection;
}

export async function getGoogleDriveAccessToken(connectionInput, options = {}) {
  const env = options.env || process.env;
  const connection = normalizeGoogleOAuthConnection(connectionInput);
  const cached = accessTokenCache.get("google_drive");
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const inFlight = refreshOperations.get("google_drive");
  if (inFlight) return inFlight;

  const operation = (async () => {
    const config = getGoogleConfig(env);
    const refreshToken = decryptSecret(connection.encryptedRefreshToken, {
      env,
      purpose: "google-drive-refresh-token"
    });
    const tokens = await postGoogleToken({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }, options.fetchImpl || fetch);

    if (typeof tokens.scope === "string") {
      const refreshedScopes = new Set(tokens.scope.split(/\s+/).filter(Boolean));
      if (!connection.grantedScopes.every((scope) => refreshedScopes.has(scope))) {
        throw new Error("A Google Drive permission is no longer granted. Reconnect and review the requested access.");
      }
    }
    if (typeof tokens.refresh_token === "string" && tokens.refresh_token) {
      const updated = normalizeGoogleOAuthConnection({
        ...connection,
        encryptedRefreshToken: encryptSecret(tokens.refresh_token, { env, purpose: "google-drive-refresh-token" }),
        updatedAt: new Date().toISOString()
      });
      if (typeof options.onRefresh === "function") await options.onRefresh(updated);
    }
    cacheAccessToken(tokens.access_token, tokens.expires_in);
    return tokens.access_token;
  })();

  refreshOperations.set("google_drive", operation);
  try { return await operation; }
  finally { refreshOperations.delete("google_drive"); }
}

export async function revokeGoogleOAuthConnection(connectionInput, options = {}) {
  const env = options.env || process.env;
  const connection = normalizeGoogleOAuthConnection(connectionInput);
  const refreshToken = decryptSecret(connection.encryptedRefreshToken, {
    env,
    purpose: "google-drive-refresh-token"
  });
  let response;
  try {
    response = await (options.fetchImpl || fetch)("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
      redirect: "error",
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("Google did not confirm permission revocation. The JARVIS connection was kept.");
    }
    throw new Error("Could not contact Google to revoke access. The JARVIS connection was kept.");
  }
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch { /* safe generic fallback */ }
    if (payload.error !== "invalid_token") {
      throw new Error("Google did not confirm permission revocation. The JARVIS connection was kept.");
    }
  }
  clearGoogleDriveTokenCache();
  return { revoked: true };
}

export function clearGoogleDriveTokenCache() {
  accessTokenCache.delete("google_drive");
}

export function getIntegrationPermissionCatalog(connection, env = process.env) {
  const google = getGoogleOAuthStatus(connection, env);
  const githubConfigured = Boolean(cleanString(env.JARVIS_GITHUB_TOKEN, 500));
  const telegramConfigured = Boolean(cleanString(env.JARVIS_TELEGRAM_BOT_TOKEN, 500));
  const elevenLabsConfigured = Boolean(cleanString(env.JARVIS_ELEVENLABS_API_KEY, 500));
  return [
    {
      provider: "google_drive",
      authModel: "OAuth 2.0 authorization code with PKCE",
      status: google.connected ? "connected" : "not_connected",
      requestedScopes: google.requiredScopes,
      grantedScopes: google.grantedScopes,
      actions: google.canCreateDocs ? ["List file names and metadata", "Create new Google Docs files"] : ["List file names and metadata"],
      accessBoundary: google.canCreateDocs
        ? "Reads file names and metadata. drive.file allows JARVIS to create and edit files created by this app; it does not request broad Drive access or permission to edit unrelated existing files."
        : "Read-only Drive metadata. Creating Google Docs requires a separate explicit drive.file consent upgrade."
    },
    {
      provider: "youtube",
      authModel: "Separate, incremental Google OAuth permission",
      status: google.canUploadYouTube ? "connected" : google.canConnect ? "not_connected" : "not_configured",
      requestedScopes: [YOUTUBE_UPLOAD_SCOPE],
      grantedScopes: google.grantedScopes.includes(YOUTUBE_UPLOAD_SCOPE) ? [YOUTUBE_UPLOAD_SCOPE] : [],
      actions: google.canUploadYouTube ? ["Upload a video after an explicit owner confirmation"] : ["Request YouTube upload permission when publishing is needed"],
      accessBoundary: "youtube.upload permission only. JARVIS does not request channel management, analytics or account-wide YouTube permissions. The upload target and visibility are reviewed before each upload."
    },
    {
      provider: "github",
      authModel: "Fine-grained personal access token or GitHub App installation",
      status: githubConfigured ? "configured" : "not_configured",
      requestedScopes: [],
      grantedScopes: [],
      actions: ["Read repository metadata"],
      accessBoundary: "Use an installation or token with metadata read access only. Broad OAuth App scopes are not used."
    },
    {
      provider: "telegram",
      authModel: "Telegram bot token",
      status: telegramConfigured ? "configured" : "not_configured",
      requestedScopes: [],
      grantedScopes: [],
      actions: ["Read bot profile"],
      accessBoundary: "Bot identity lookup only. No message or chat actions."
    },
    {
      provider: "elevenlabs",
      authModel: "Restricted API key",
      status: elevenLabsConfigured ? "configured" : "not_configured",
      requestedScopes: [],
      grantedScopes: [],
      actions: ["Read account subscription summary"],
      accessBoundary: "Use endpoint-restricted API key. No audio generation actions."
    }
  ];
}
