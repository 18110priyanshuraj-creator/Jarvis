import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginGoogleOAuth,
  clearGoogleDriveTokenCache,
  decryptSecret,
  encryptSecret,
  finishGoogleOAuth,
  getGoogleDriveAccessToken,
  getGoogleOAuthStatus,
  getIntegrationPermissionCatalog,
  isTokenVaultConfigured,
  revokeGoogleOAuthConnection,
  GOOGLE_DRIVE_METADATA_SCOPE
} from "../services/oauth.js";

const env = {
  JARVIS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  JARVIS_GOOGLE_OAUTH_CLIENT_ID: "local-test-client.apps.exampleusercontent.com",
  JARVIS_GOOGLE_OAUTH_CLIENT_SECRET: "local-test-client-secret",
  JARVIS_GOOGLE_OAUTH_REDIRECT_URI: "https://jarvis.example.com/api/integrations/google_drive/oauth/callback"
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function startFlow() {
  return beginGoogleOAuth({ sessionToken: "test-session-id", env });
}

async function authorize(fetchImpl, existingConnection) {
  const flow = startFlow();
  const url = new URL(flow.authorizationUrl);
  const connection = await finishGoogleOAuth({
    state: url.searchParams.get("state"),
    browserBinding: flow.browserBinding,
    code: "test-authorization-code",
    existingConnection,
    isSessionValid: (id) => id === "test-session-id",
    env,
    fetchImpl
  });
  return connection;
}

test("token vault encrypts secrets with authenticated AES-GCM and separates purposes", () => {
  const secret = "refresh-token-test-value";
  const record = encryptSecret(secret, { env, purpose: "google-drive-refresh-token" });
  assert.equal(record.algorithm, "aes-256-gcm");
  assert.notEqual(record.ciphertext, Buffer.from(secret).toString("base64url"));
  assert.equal(decryptSecret(record, { env, purpose: "google-drive-refresh-token" }), secret);
  assert.throws(() => decryptSecret(record, { env, purpose: "different-purpose" }));
  assert.equal(isTokenVaultConfigured(env), true);
  assert.equal(isTokenVaultConfigured({}), false);
});

test("token vault rejects invalid and short encryption keys", () => {
  assert.throws(() => encryptSecret("test-value", { env: {} }), /JARVIS_TOKEN_ENCRYPTION_KEY/);
  assert.throws(
    () => encryptSecret("test-value", { env: { JARVIS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(8).toString("base64") } }),
    /exactly 32 bytes/
  );
});

test("Google OAuth start uses state, PKCE S256, offline access and a single metadata scope", () => {
  const flow = startFlow();
  const url = new URL(flow.authorizationUrl);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), GOOGLE_DRIVE_METADATA_SCOPE);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "false");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge").length > 20);
  assert.ok(url.searchParams.get("state").length > 20);
  assert.equal(flow.authorizationUrl.includes(env.JARVIS_GOOGLE_OAUTH_CLIENT_SECRET), false);
});

test("OAuth callback encrypts the refresh token and verifies browser binding and session", async () => {
  const fakeFetch = async (_url, options) => {
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.ok(body.get("code_verifier").length > 20);
    assert.equal(body.get("redirect_uri"), env.JARVIS_GOOGLE_OAUTH_REDIRECT_URI);
    return response({
      access_token: "temporary-access-value",
      refresh_token: "persistent-refresh-value",
      expires_in: 3600,
      scope: GOOGLE_DRIVE_METADATA_SCOPE
    });
  };
  const connection = await authorize(fakeFetch);
  const encoded = JSON.stringify(connection);
  assert.equal(encoded.includes("persistent-refresh-value"), false);
  assert.equal(decryptSecret(connection.encryptedRefreshToken, { env, purpose: "google-drive-refresh-token" }), "persistent-refresh-value");
  const status = getGoogleOAuthStatus(connection, env);
  assert.equal(status.connected, true);
  assert.deepEqual(status.grantedScopes, [GOOGLE_DRIVE_METADATA_SCOPE]);
});

test("OAuth state is one-time and cannot be completed from a different browser binding", async () => {
  const flow = startFlow();
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  await assert.rejects(() => finishGoogleOAuth({
    state,
    browserBinding: "different-browser",
    code: "test-code",
    isSessionValid: () => true,
    env,
    fetchImpl: async () => response({})
  }), /browser verification failed/i);
  await assert.rejects(() => finishGoogleOAuth({
    state,
    browserBinding: flow.browserBinding,
    code: "test-code",
    isSessionValid: () => true,
    env,
    fetchImpl: async () => response({})
  }), /invalid, expired, or already used/i);
});

test("OAuth callback requires the original authenticated JARVIS session", async () => {
  const flow = startFlow();
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  await assert.rejects(() => finishGoogleOAuth({
    state,
    browserBinding: flow.browserBinding,
    code: "test-code",
    isSessionValid: () => false,
    env,
    fetchImpl: async () => response({})
  }), /session expired/i);
});

test("OAuth callback refuses broader or missing Drive permissions", async () => {
  const flow = startFlow();
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  await assert.rejects(() => finishGoogleOAuth({
    state,
    browserBinding: flow.browserBinding,
    code: "test-code",
    isSessionValid: () => true,
    env,
    fetchImpl: async () => response({
      access_token: "temporary-access-value",
      refresh_token: "persistent-refresh-value",
      scope: "https://www.googleapis.com/auth/drive"
    })
  }), /only the required read-only Drive metadata permission/i);

  const extraScopeFlow = startFlow();
  const extraScopeState = new URL(extraScopeFlow.authorizationUrl).searchParams.get("state");
  await assert.rejects(() => finishGoogleOAuth({
    state: extraScopeState,
    browserBinding: extraScopeFlow.browserBinding,
    code: "test-code",
    isSessionValid: () => true,
    env,
    fetchImpl: async () => response({
      access_token: "temporary-access-value",
      refresh_token: "persistent-refresh-value",
      scope: GOOGLE_DRIVE_METADATA_SCOPE + " https://www.googleapis.com/auth/drive"
    })
  }), /only the required read-only Drive metadata permission/i);
});

test("Google Drive access tokens refresh on demand and cache until near expiry", async () => {
  clearGoogleDriveTokenCache();
  const connection = await authorize(async () => response({
    access_token: "initial-access-value",
    refresh_token: "persistent-refresh-value",
    expires_in: 3600,
    scope: GOOGLE_DRIVE_METADATA_SCOPE
  }));
  clearGoogleDriveTokenCache();
  let calls = 0;
  const fakeFetch = async (_url, options) => {
    calls += 1;
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "persistent-refresh-value");
    return response({ access_token: "refreshed-access-value", expires_in: 1800 });
  };
  const first = await getGoogleDriveAccessToken(connection, { env, fetchImpl: fakeFetch });
  const second = await getGoogleDriveAccessToken(connection, { env, fetchImpl: fakeFetch });
  assert.equal(first, "refreshed-access-value");
  assert.equal(second, first);
  assert.equal(calls, 1);
  clearGoogleDriveTokenCache();
});

test("rotated refresh tokens are re-encrypted and persisted through callback", async () => {
  clearGoogleDriveTokenCache();
  const connection = await authorize(async () => response({
    access_token: "first-access",
    refresh_token: "original-refresh",
    expires_in: 3600,
    scope: GOOGLE_DRIVE_METADATA_SCOPE
  }));
  clearGoogleDriveTokenCache();
  let persisted = null;
  const next = await getGoogleDriveAccessToken(connection, {
    env,
    fetchImpl: async () => response({
      access_token: "next-access",
      refresh_token: "rotated-refresh",
      expires_in: 1800
    }),
    onRefresh: async (updated) => { persisted = updated; }
  });
  assert.equal(next, "next-access");
  assert.ok(persisted);
  assert.equal(decryptSecret(persisted.encryptedRefreshToken, { env, purpose: "google-drive-refresh-token" }), "rotated-refresh");
  assert.equal(JSON.stringify(persisted).includes("rotated-refresh"), false);
  clearGoogleDriveTokenCache();
});

test("revocation sends only the refresh token and clears the access-token cache", async () => {
  const connection = await authorize(async () => response({
    access_token: "first-access",
    refresh_token: "revocation-refresh",
    expires_in: 3600,
    scope: GOOGLE_DRIVE_METADATA_SCOPE
  }));
  let requestBody = null;
  await revokeGoogleOAuthConnection(connection, {
    env,
    fetchImpl: async (_url, options) => {
      requestBody = new URLSearchParams(options.body);
      return new Response(null, { status: 200 });
    }
  });
  assert.equal(requestBody.get("token"), "revocation-refresh");
  assert.equal(requestBody.has("client_secret"), false);
});

test("OAuth callback and revocation failures return safe messages", async () => {
  const flow = startFlow();
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  await assert.rejects(() => finishGoogleOAuth({
    state,
    browserBinding: flow.browserBinding,
    code: "test-code",
    isSessionValid: () => true,
    env,
    fetchImpl: async () => response({ error: "invalid_grant" }, 400)
  }), /rejected the OAuth exchange/i);
});

test("permission catalogue reports configured and granted permission states without secrets", async () => {
  const connection = await authorize(async () => response({
    access_token: "temporary-access-value",
    refresh_token: "persistent-refresh-value",
    expires_in: 3600,
    scope: GOOGLE_DRIVE_METADATA_SCOPE
  }));
  const permissionList = getIntegrationPermissionCatalog(connection, {
    ...env,
    JARVIS_GITHUB_TOKEN: "configured-github-value",
    JARVIS_TELEGRAM_BOT_TOKEN: "configured-telegram-value",
    JARVIS_ELEVENLABS_API_KEY: "configured-eleven-value"
  });
  assert.equal(permissionList.find((item) => item.provider === "google_drive").status, "connected");
  assert.deepEqual(permissionList.find((item) => item.provider === "google_drive").grantedScopes, [GOOGLE_DRIVE_METADATA_SCOPE]);
  assert.equal(permissionList.find((item) => item.provider === "github").status, "configured");
  assert.equal(permissionList.find((item) => item.provider === "telegram").status, "configured");
  assert.equal(permissionList.find((item) => item.provider === "elevenlabs").status, "configured");
  assert.equal(JSON.stringify(permissionList).includes("configured-github-value"), false);
  assert.equal(JSON.stringify(permissionList).includes("persistent-refresh-value"), false);
});

test("Google OAuth configuration rejects insecure public callback URLs", () => {
  assert.throws(() => beginGoogleOAuth({
    sessionToken: "test-session-id",
    env: {
      ...env,
      JARVIS_GOOGLE_OAUTH_REDIRECT_URI: "http://public.example.com/api/integrations/google_drive/oauth/callback"
    }
  }), /must be HTTPS/i);
  assert.throws(() => beginGoogleOAuth({
    sessionToken: "test-session-id",
    env: {
      ...env,
      JARVIS_GOOGLE_OAUTH_REDIRECT_URI: "https://jarvis.example.com/other/callback"
    }
  }), /exact JARVIS callback path/i);
});

test("Google refresh failures do not return provider response bodies", async () => {
  const connection = await authorize(async () => response({
    access_token: "temporary-access-value",
    refresh_token: "persistent-refresh-value",
    expires_in: 3600,
    scope: GOOGLE_DRIVE_METADATA_SCOPE
  }));
  clearGoogleDriveTokenCache();
  await assert.rejects(() => getGoogleDriveAccessToken(connection, {
    env,
    fetchImpl: async () => response({ error: "invalid_grant", error_description: "private detail must not surface" }, 400)
  }), (error) => {
    assert.match(error.message, /rejected the OAuth exchange/i);
    assert.equal(error.message.includes("private detail"), false);
    return true;
  });
  clearGoogleDriveTokenCache();
});

test("stored connection status stays disconnected when the configured vault key cannot decrypt it", async () => {
  const connection = await authorize(async () => response({
    access_token: "temporary-access-value",
    refresh_token: "persistent-refresh-value",
    expires_in: 3600,
    scope: GOOGLE_DRIVE_METADATA_SCOPE
  }));
  const status = getGoogleOAuthStatus(connection, {
    ...env,
    JARVIS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64")
  });
  assert.equal(status.connected, false);
});
