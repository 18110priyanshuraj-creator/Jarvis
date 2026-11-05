import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  beginCanvaOAuth,
  CANVA_SCOPES,
  clearCanvaTokenCache,
  createCanvaThumbnailDesign,
  finishCanvaOAuth,
  getCanvaAccessToken,
  getCanvaOAuthStatus,
  normalizeCanvaOAuthConnection,
  revokeCanvaOAuthConnection
} from "../services/canva-connect.js";
import { createRuntimeStore } from "../services/runtime-store.js";

const env = {
  JARVIS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString("base64"),
  JARVIS_CANVA_OAUTH_CLIENT_ID: "local-canva-test-client",
  JARVIS_CANVA_OAUTH_CLIENT_SECRET: "local-canva-test-secret",
  JARVIS_CANVA_OAUTH_REDIRECT_URI: "https://jarvis.example.com/api/integrations/canva/oauth/callback"
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("Canva OAuth status reports setup prerequisites without claiming a connection", () => {
  const missing = getCanvaOAuthStatus(null, {});
  assert.equal(missing.configured, false);
  assert.equal(missing.vaultConfigured, false);
  assert.equal(missing.canConnect, false);
  assert.equal(missing.connected, false);
  const ready = getCanvaOAuthStatus(null, env);
  assert.equal(ready.configured, true);
  assert.equal(ready.vaultConfigured, true);
  assert.equal(ready.canConnect, true);
  assert.equal(ready.connected, false);
});

test("Canva OAuth starts with PKCE and only the requested asset/design scopes", async () => {
  const flow = await beginCanvaOAuth({ sessionToken: "test-session", env });
  const url = new URL(flow.authorizationUrl);
  assert.equal(url.origin, "https://www.canva.com");
  assert.equal(url.pathname, "/api/oauth/authorize");
  assert.deepEqual(url.searchParams.get("scope").split(" ").sort(), [...CANVA_SCOPES].sort());
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge").length > 20);
  assert.ok(url.searchParams.get("state").length > 20);
  assert.equal(flow.authorizationUrl.includes(env.JARVIS_CANVA_OAUTH_CLIENT_SECRET), false);
});

test("Canva OAuth callback is single-use, browser-bound and saves encrypted refresh credentials", async () => {
  const runtimeStore = createRuntimeStore();
  await runtimeStore.createSession("test-session", 60_000);
  const flow = await beginCanvaOAuth({ sessionToken: "test-session", env, runtimeStore });
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  let tokenRequest;
  const fetchImpl = async (url, options) => {
    tokenRequest = { url, options };
    return jsonResponse({
      access_token: "canva-temporary-access-token",
      refresh_token: "canva-persistent-refresh-token",
      expires_in: 3600,
      scope: CANVA_SCOPES.join(" ")
    });
  };
  const sessionHash = (await import("node:crypto")).createHash("sha256")
    .update("test-session").digest("base64url");
  const connection = await finishCanvaOAuth({
    state,
    browserBinding: flow.browserBinding,
    code: "test-canva-auth-code",
    runtimeStore,
    isSessionValid: async (hash) => hash === sessionHash,
    env,
    fetchImpl
  });
  assert.equal(tokenRequest.url, "https://api.canva.com/rest/v1/oauth/token");
  assert.match(tokenRequest.options.headers.Authorization, /^Basic /);
  assert.equal(tokenRequest.options.body.get("grant_type"), "authorization_code");
  assert.ok(tokenRequest.options.body.get("code_verifier"));
  assert.equal(JSON.stringify(connection).includes("canva-persistent-refresh-token"), false);
  const status = getCanvaOAuthStatus(connection, env);
  assert.equal(status.connected, true);
  assert.deepEqual(status.grantedScopes, [...CANVA_SCOPES].sort());
  await assert.rejects(() => finishCanvaOAuth({
    state,
    browserBinding: flow.browserBinding,
    code: "replay",
    runtimeStore,
    isSessionValid: async () => true,
    env,
    fetchImpl
  }), /invalid, expired or already used/i);
});

test("Canva access token refresh uses the encrypted refresh token", async () => {
  const flow = await beginCanvaOAuth({ sessionToken: "test-session", env });
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  const sessionHash = createHash("sha256").update("test-session").digest("base64url");
  const connection = await finishCanvaOAuth({
    state,
    browserBinding: flow.browserBinding,
    code: "token-code",
    isSessionValid: async () => true,
    env,
    fetchImpl: async () => jsonResponse({
      access_token: "canva-first-access-token",
      refresh_token: "canva-refresh-token",
      expires_in: 1,
      scope: CANVA_SCOPES.join(" ")
    })
  });
  clearCanvaTokenCache();
  let refreshed = false;
  const accessToken = await getCanvaAccessToken(connection, {
    env,
    fetchImpl: async (_url, options) => {
      refreshed = options.body.get("grant_type") === "refresh_token" &&
        options.body.get("refresh_token") === "canva-refresh-token";
      return jsonResponse({
        access_token: "canva-refreshed-access-token",
        expires_in: 3600,
        scope: CANVA_SCOPES.join(" ")
      });
    }
  });
  assert.equal(refreshed, true);
  assert.equal(accessToken, "canva-refreshed-access-token");
  clearCanvaTokenCache();
});

test("Canva thumbnail flow uploads a valid 1280x720 PNG then creates a new design", async () => {
  const bytes = Buffer.alloc(2048);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(1280, 16);
  bytes.writeUInt32BE(720, 20);
  const calls = [];
  const design = await createCanvaThumbnailDesign({
    accessToken: "canva-test-access-token-value",
    bytes,
    name: "A good thumbnail",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/asset-uploads")) {
        assert.equal(options.method, "POST");
        assert.equal(options.headers["Content-Type"], "application/octet-stream");
        assert.equal(options.body, bytes);
        return jsonResponse({ job: { id: "upload-job-1", status: "success", asset: { id: "asset-123" } } });
      }
      if (url.endsWith("/designs")) {
        const body = JSON.parse(options.body);
        assert.equal(body.asset_id, "asset-123");
        assert.deepEqual(body.design_type, { type: "custom", width: 1280, height: 720 });
        return jsonResponse({
          design: {
            id: "design-123",
            title: "A good thumbnail",
            urls: { edit_url: "https://www.canva.com/design/DA1/edit", view_url: "https://www.canva.com/design/DA1/view" }
          }
        });
      }
      throw new Error("Unexpected Canva URL: " + url);
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(design.designId, "design-123");
  assert.equal(design.editUrl, "https://www.canva.com/design/DA1/edit");
  assert.match(design.note, /flat image/i);
});

test("Canva thumbnail flow rejects non-PNG, wrong dimensions and untrusted edit URLs", async () => {
  const bytes = Buffer.alloc(2048);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(640, 16);
  bytes.writeUInt32BE(360, 20);
  await assert.rejects(() => createCanvaThumbnailDesign({
    accessToken: "canva-test-access-token-value",
    bytes
  }), /1280 × 720/i);
  const valid = Buffer.from(bytes);
  valid.writeUInt32BE(1280, 16);
  valid.writeUInt32BE(720, 20);
  await assert.rejects(() => createCanvaThumbnailDesign({
    accessToken: "canva-test-access-token-value",
    bytes: valid,
    fetchImpl: async (url) => url.endsWith("/asset-uploads")
      ? jsonResponse({ job: { id: "job", status: "success", asset: { id: "asset-1" } } })
      : jsonResponse({ design: { id: "design", urls: { edit_url: "https://evil.example/design" } } })
  }), /unexpected design URL/i);
});

test("Canva disconnect revokes the refresh-token lineage before local credentials are removed", async () => {
  const flow = await beginCanvaOAuth({ sessionToken: "disconnect-session", env });
  const state = new URL(flow.authorizationUrl).searchParams.get("state");
  const connection = await finishCanvaOAuth({
    state,
    browserBinding: flow.browserBinding,
    code: "disconnect-code",
    isSessionValid: async () => true,
    env,
    fetchImpl: async () => jsonResponse({
      access_token: "canva-disconnect-access",
      refresh_token: "canva-disconnect-refresh",
      expires_in: 3600,
      scope: CANVA_SCOPES.join(" ")
    })
  });
  let revokedToken = "";
  const result = await revokeCanvaOAuthConnection(connection, {
    env,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.canva.com/rest/v1/oauth/revoke");
      assert.match(options.headers.Authorization, /^Basic /);
      revokedToken = options.body.get("token");
      return new Response("", { status: 200 });
    }
  });
  assert.equal(revokedToken, "canva-disconnect-refresh");
  assert.deepEqual(result, { revoked: true });
  await assert.rejects(() => revokeCanvaOAuthConnection(connection, {
    env,
    fetchImpl: async () => new Response("", { status: 503 })
  }), /connection was kept/i);
});
