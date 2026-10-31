import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let child;
let baseUrl;
let cookie = "";
let tempDir;
let childOutput = "";

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  return fetch(baseUrl + route, { ...options, headers });
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-device-test-"));
  const port = await freePort();
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      JARVIS_PASSWORD: "test-only-password-2026",
      JARVIS_DATA_DIR: tempDir,
      DATABASE_URL: "",
      GEMINI_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error("JARVIS test server exited early:\n" + childOutput);
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) { ready = true; break; }
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("JARVIS test server did not start:\n" + childOutput);
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit").catch(() => {});
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2500))]);
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test("paired Android devices can authenticate, use voice chat, and be revoked", async () => {
  const unauthenticatedList = await request("/api/devices", { headers: {} });
  assert.equal(unauthenticatedList.status, 401);

  const login = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-only-password-2026" })
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^jarvis_session=/);

  const challengeResponse = await request("/api/devices/pairing-challenges", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert.equal(challengeResponse.status, 201);
  const challenge = await challengeResponse.json();
  assert.match(challenge.code, /^\d{6}$/);

  const pairResponse = await request("/api/devices/pair", {
    method: "POST",
    headers: {},
    body: JSON.stringify({
      code: challenge.code,
      name: "Test Android Tablet",
      manufacturer: "Samsung",
      model: "Galaxy Tab A9",
      androidVersion: "16",
      appVersion: "0.1.0-phase1"
    })
  });
  assert.equal(pairResponse.status, 201);
  const paired = await pairResponse.json();
  assert.match(paired.deviceToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(paired.device.name, "Test Android Tablet");
  assert.equal("tokenHash" in paired.device, false);

  const listResponse = await request("/api/devices");
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.devices.length, 1);
  assert.equal("tokenHash" in list.devices[0], false);
  assert.equal("deviceToken" in list.devices[0], false);

  const badHeartbeat = await request("/api/devices/heartbeat", {
    method: "POST",
    headers: {},
    body: JSON.stringify({ accessibilityEnabled: false })
  });
  assert.equal(badHeartbeat.status, 401);

  const heartbeat = await request("/api/devices/heartbeat", {
    method: "POST",
    headers: { Authorization: "Bearer " + paired.deviceToken },
    body: JSON.stringify({ accessibilityEnabled: true, appVersion: "0.1.0-phase1" })
  });
  assert.equal(heartbeat.status, 200);
  assert.equal((await heartbeat.json()).device.accessibilityEnabled, true);

  const noGeminiPlan = await request("/api/devices/plan", {
    method: "POST",
    headers: { Authorization: "Bearer " + paired.deviceToken },
    body: JSON.stringify({ message: "Open YouTube and search JEE Physics" })
  });
  assert.equal(noGeminiPlan.status, 503);
  assert.equal((await noGeminiPlan.json()).code, "AI_NOT_CONFIGURED");

  const voice = await request("/api/devices/voice-command", {
    method: "POST",
    headers: { Authorization: "Bearer " + paired.deviceToken },
    body: JSON.stringify({ message: "calculate 2 + 2" })
  });
  assert.equal(voice.status, 200);
  const voicePayload = await voice.json();
  assert.match(voicePayload.answer, /4/);
  assert.equal(voicePayload.externalAI, false);

  const revoke = await request("/api/devices/" + encodeURIComponent(paired.device.id), { method: "DELETE" });
  assert.equal(revoke.status, 200);

  const afterRevoke = await request("/api/devices/heartbeat", {
    method: "POST",
    headers: { Authorization: "Bearer " + paired.deviceToken },
    body: JSON.stringify({})
  });
  assert.equal(afterRevoke.status, 401);
});
