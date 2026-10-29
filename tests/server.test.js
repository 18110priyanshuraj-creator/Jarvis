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
  const address = probe.address();
  const port = address.port;
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-test-"));
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
      AI_PROVIDER: "ollama",
      GEMINI_API_KEY: "",
      OLLAMA_BASE_URL: "http://127.0.0.1:1",
      JARVIS_MODEL: "nonexistent-test-model",
      SEARXNG_URL: ""
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

test("health endpoint is public without disclosing configuration", async () => {
  const response = await request("/api/health", { headers: {} });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.service, "jarvis");
  assert.equal(JSON.stringify(payload).includes("test-only-password-2026"), false);
});

test("authentication, same-origin protection, tasks, memories, and model failures behave safely", async (t) => {
  const blockedState = await request("/api/state", { headers: {} });
  assert.equal(blockedState.status, 401);

  const wrongLogin = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "wrong-password" })
  });
  assert.equal(wrongLogin.status, 401);

  const login = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-only-password-2026" })
  });
  assert.equal(login.status, 200);
  const cookieHeader = login.headers.get("set-cookie") || "";
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Strict/i);
  cookie = cookieHeader.split(";")[0];
  assert.match(cookie, /^jarvis_session=/);

  const crossOrigin = await request("/api/tasks", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
    body: JSON.stringify({ title: "Must be blocked" })
  });
  assert.equal(crossOrigin.status, 403);

  const createTask = await request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title: "Integration test task", description: "Check task flow" })
  });
  assert.equal(createTask.status, 201);
  const taskPayload = await createTask.json();
  assert.equal(taskPayload.task.title, "Integration test task");
  assert.equal(taskPayload.task.done, false);

  const completeTask = await request("/api/tasks/" + taskPayload.task.id, {
    method: "PATCH",
    body: JSON.stringify({ done: true })
  });
  assert.equal(completeTask.status, 200);
  assert.equal((await completeTask.json()).task.done, true);

  const createMemory = await request("/api/memories", {
    method: "POST",
    body: JSON.stringify({ content: "Prefer step-by-step explanations", category: "preference" })
  });
  assert.equal(createMemory.status, 201);
  const memoryPayload = await createMemory.json();

  const currentState = await request("/api/state");
  assert.equal(currentState.status, 200);
  const snapshot = await currentState.json();
  assert.equal(snapshot.tasks.some((item) => item.id === taskPayload.task.id), true);
  assert.equal(snapshot.memories.some((item) => item.id === memoryPayload.memory.id), true);

  const deleteMemory = await request("/api/memories/" + memoryPayload.memory.id, { method: "DELETE" });
  assert.equal(deleteMemory.status, 200);
  const deleteTask = await request("/api/tasks/" + taskPayload.task.id, { method: "DELETE" });
  assert.equal(deleteTask.status, 200);

  const searchDisabled = await request("/api/search?q=test");
  assert.equal(searchDisabled.status, 503);

  const modelUnavailable = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "This should report that the model server is unavailable." })
  });
  assert.equal(modelUnavailable.status, 503);
  assert.match((await modelUnavailable.json()).error, /model server/i);

  const logout = await request("/api/logout", { method: "POST", body: JSON.stringify({}) });
  assert.equal(logout.status, 200);
  cookie = "";
  const afterLogout = await request("/api/state", { headers: {} });
  assert.equal(afterLogout.status, 401);
});
