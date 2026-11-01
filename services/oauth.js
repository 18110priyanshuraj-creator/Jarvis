import crypto from "node:crypto";

export const GOOGLE_DRIVE_METADATA_SCOPE =
  "https://www.googleapis.com/auth/drive.metadata.readonly";
const GOOGLE_CALLBACK_PATH = "/api/integrations/google_drive/oauth/callback";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 8000;
const pendingStates = new Map();
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
      !input.grantedScopes.includes(GOOGLE_DRIVE_METADATA_SCOPE)) {
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
    grantedScopes: [GOOGLE_DRIVE_METADATA_SCOPE],
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
}

export function beginGoogleOAuth({ sessionToken, env = process.env }) {
  if (!cleanString(sessionToken, 200)) throw new Error("Sign in to JARVIS before connecting Google Drive.");
  getEncryptionKey(env);
  const config = getGoogleConfig(env);
  prunePendingStates();

  const state = crypto.randomBytes(32).toString("base64url");
  const browserBinding = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = hash(verifier).toString("base64url");
  pendingStates.set(state, {
    sessionToken,
    browserBindingHash: hash(browserBinding).toString("base64url"),
    verifier,
    createdAt: Date.now(),
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_DRIVE_METADATA_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return { authorizationUrl: url.toString(), browserBinding };
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

export async function finishGoogleOAuth(options = {}) {
  const state = cleanString(options.state, 200);
  const pending = pendingStates.get(state);
  if (!pending) throw new Error("Google OAuth state is invalid, expired, or already used.");
  pendingStates.delete(state);
  if (pending.expiresAt <= Date.now()) {
    throw new Error("Google OAuth state expired. Start the connection again.");
  }

  const browserHash = hash(cleanString(options.browserBinding, 200)).toString("base64url");
  if (!timingSafeStringEqual(browserHash, pending.browserBindingHash)) {
    throw new Error("Google OAuth browser verification failed. Start the connection again.");
  }
  if (typeof options.isSessionValid !== "function" || !options.isSessionValid(pending.sessionToken)) {
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
  if (scopes.length !== 1 || scopes[0] !== GOOGLE_DRIVE_METADATA_SCOPE) {
    throw new Error("Google did not grant only the required read-only Drive metadata permission. No connection was saved.");
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
    grantedScopes: [GOOGLE_DRIVE_METADATA_SCOPE],
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

    if (typeof tokens.scope === "string" &&
        !tokens.scope.split(/\s+/).includes(GOOGLE_DRIVE_METADATA_SCOPE)) {
      throw new Error("Google Drive metadata permission is no longer granted. Reconnect the service.");
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
      actions: ["List file names and metadata"],
      accessBoundary: "Read-only Drive metadata. File contents and write operations are not requested."
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
