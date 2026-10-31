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
      DATABASE_URL: "",
      GEMINI_API_KEY: "",
      GEMINI_CHAT_ENABLED: "false",
      GEMINI_WEB_RESEARCH_ENABLED: "false",
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
  assert.equal(payload.plannerAIEnabled, false);
  assert.equal(payload.conversationAIEnabled, false);
  assert.equal(payload.webResearchEnabled, false);
  assert.equal(payload.externalAI, false);
  assert.equal(payload.aiProvider.provider, "gemini");
  assert.equal(payload.aiProvider.configured, false);
  assert.equal(payload.aiProvider.model, "gemini-3.8-flash");
  assert.equal(Object.hasOwn(payload.aiProvider, "apiKey"), false);
  assert.equal(JSON.stringify(payload).includes("test-only-password-2026"), false);
});

test("authentication, local search, tasks, memories, and offline chat behave safely", async () => {
  const blockedState = await request("/api/state", { headers: {} });
  assert.equal(blockedState.status, 401);
  const blockedKnowledge = await request("/api/knowledge", { headers: {} });
  assert.equal(blockedKnowledge.status, 401);
  const blockedResearch = await request("/api/research", {
    method: "POST",
    headers: {},
    body: JSON.stringify({ query: "What changed in the latest science research?" })
  });
  assert.equal(blockedResearch.status, 401);

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

  const savedResearch = await request("/api/research/saved", {
    method: "POST",
    body: JSON.stringify({
      query: "How does solar energy work?",
      answer: "Solar panels convert sunlight into electrical energy.",
      searchedAt: "2026-10-31T00:00:00.000Z",
      sources: [
        { title: "Official energy guide", url: "https://energy.example/solar" },
        { title: "Unsafe source", url: "javascript:alert(1)" }
      ]
    })
  });
  assert.equal(savedResearch.status, 201);
  const savedResearchPayload = await savedResearch.json();
  assert.equal(savedResearchPayload.item.sources.length, 1);

  const savedKnowledge = await request("/api/knowledge", {
    method: "POST",
    body: JSON.stringify({
      title: "Solar energy basics",
      content: "Photovoltaic cells convert sunlight into electricity.",
      category: "science",
      tags: ["solar", "energy"],
      sourceKind: "web-research",
      sourceQuery: "How do solar panels work?",
      sources: [{ title: "Official solar guide", url: "https://energy.example/solar" }],
      citations: [{ claim: "Photovoltaic cells convert sunlight into electricity.", sourceUrls: ["https://energy.example/solar"] }]
    })
  });
  assert.equal(savedKnowledge.status, 201);
  const knowledgePayload = await savedKnowledge.json();
  assert.equal(knowledgePayload.item.reviewStatus, "unreviewed");
  assert.equal(knowledgePayload.item.sources.length, 1);

  const duplicateKnowledge = await request("/api/knowledge", {
    method: "POST",
    body: JSON.stringify({
      title: " solar   energy basics ",
      content: "PHOTOVOLTAIC cells convert sunlight into electricity. ",
      category: "science",
      sourceKind: "web-research",
      sources: [{ url: "https://energy.example/solar" }]
    })
  });
  assert.equal(duplicateKnowledge.status, 200);
  assert.equal((await duplicateKnowledge.json()).duplicate, true);

  const knowledgeSearch = await request("/api/knowledge?q=photovoltaic");
  assert.equal(knowledgeSearch.status, 200);
  const knowledgeSearchPayload = await knowledgeSearch.json();
  assert.equal(knowledgeSearchPayload.total, 1);
  assert.equal(knowledgeSearchPayload.items[0].id, knowledgePayload.item.id);

  const combinedSearch = await request("/api/search?q=photovoltaic");
  assert.equal(combinedSearch.status, 200);
  const combinedPayload = await combinedSearch.json();
  assert.equal(combinedPayload.externalSearch, false);
  assert.ok(combinedPayload.results.some((item) => item.source === "saved-knowledge"));

  const markKnowledgeReviewed = await request("/api/knowledge/" + knowledgePayload.item.id, {
    method: "PATCH",
    body: JSON.stringify({ reviewStatus: "user-reviewed" })
  });
  assert.equal(markKnowledgeReviewed.status, 200);
  assert.equal((await markKnowledgeReviewed.json()).item.reviewStatus, "user-reviewed");

  const currentState = await request("/api/state");
  assert.equal(currentState.status, 200);
  const snapshot = await currentState.json();
  assert.equal(snapshot.tasks.some((item) => item.id === taskPayload.task.id), true);
  assert.equal(snapshot.memories.some((item) => item.id === memoryPayload.memory.id), true);
  assert.equal(snapshot.research.some((item) => item.id === savedResearchPayload.item.id), true);

  const deleteSavedResearch = await request("/api/research/saved/" + savedResearchPayload.item.id, { method: "DELETE" });
  assert.equal(deleteSavedResearch.status, 200);

  const deleteKnowledge = await request("/api/knowledge/" + knowledgePayload.item.id, { method: "DELETE" });
  assert.equal(deleteKnowledge.status, 200);

  const deleteMemory = await request("/api/memories/" + memoryPayload.memory.id, { method: "DELETE" });
  assert.equal(deleteMemory.status, 200);
  const deleteTask = await request("/api/tasks/" + taskPayload.task.id, { method: "DELETE" });
  assert.equal(deleteTask.status, 200);

  const createFeedback = await request("/api/feedback", {
    method: "POST",
    body: JSON.stringify({ prompt: "Explain this simply", rating: "up", note: "Helpful example" })
  });
  assert.equal(createFeedback.status, 201);
  const feedbackPayload = await createFeedback.json();
  assert.equal(feedbackPayload.feedback.rating, "up");

  const createSkill = await request("/api/skills", {
    method: "POST",
    body: JSON.stringify({ name: "Simple Hinglish", instructions: "Explain in simple Hinglish and use one example." })
  });
  assert.equal(createSkill.status, 201);
  const skillPayload = await createSkill.json();
  assert.equal(skillPayload.skill.name, "Simple Hinglish");

  const learningState = await request("/api/state");
  const learningSnapshot = await learningState.json();
  assert.equal(learningSnapshot.feedback.some((item) => item.id === feedbackPayload.feedback.id), true);
  assert.equal(learningSnapshot.skills.some((item) => item.id === skillPayload.skill.id), true);

  assert.equal((await request("/api/feedback/" + feedbackPayload.feedback.id, { method: "DELETE" })).status, 200);
  assert.equal((await request("/api/skills/" + skillPayload.skill.id, { method: "DELETE" })).status, 200);

  const disabledWebResearch = await request("/api/research", {
    method: "POST",
    body: JSON.stringify({ query: "What changed in the latest science research?" })
  });
  assert.equal(disabledWebResearch.status, 503);

  const localSearch = await request("/api/search?q=mole%20concept");
  assert.equal(localSearch.status, 200);
  const localSearchPayload = await localSearch.json();
  assert.equal(localSearchPayload.externalSearch, false);
  assert.ok(localSearchPayload.results.some((item) => item.title === "Mole concept"));

  const localChat = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "What is 2 + 2?" })
  });
  assert.equal(localChat.status, 200);
  const chatPayload = await localChat.json();
  assert.match(chatPayload.answer, /4/);
  assert.equal(chatPayload.engine, "built-in-offline");
  assert.equal(chatPayload.externalAI, false);

  const memoryCommand = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "Remember that I prefer short Hinglish explanations." })
  });
  assert.equal(memoryCommand.status, 200);
  assert.match((await memoryCommand.json()).answer, /remember this/i);

  const blockedMemoryCommand = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "Remember that my API key is do-not-save." })
  });
  assert.equal(blockedMemoryCommand.status, 200);
  assert.match((await blockedMemoryCommand.json()).answer, /won't save/i);

  const sessionState = await request("/api/state");
  const sessionSnapshot = await sessionState.json();
  assert.ok(sessionSnapshot.chats.some((item) => item.content === "What is 2 + 2?"));
  assert.ok(sessionSnapshot.memories.some((item) => item.content === "I prefer short Hinglish explanations"));

  const persistedState = await fs.readFile(path.join(tempDir, "state.json"), "utf8");
  assert.equal(persistedState.includes("What is 2 + 2?"), false);
  assert.equal(persistedState.includes("Remember that I prefer short Hinglish explanations."), false);
  assert.equal(persistedState.includes("Explain this simply"), false);
  assert.equal(persistedState.includes("do-not-save"), false);

  const clearChat = await request("/api/chat/history", { method: "DELETE" });
  assert.equal(clearChat.status, 200);
  const emptyChatState = await request("/api/state");
  assert.deepEqual((await emptyChatState.json()).chats, []);

  const logout = await request("/api/logout", { method: "POST", body: JSON.stringify({}) });
  assert.equal(logout.status, 200);
  cookie = "";
  const afterLogout = await request("/api/state", { headers: {} });
  assert.equal(afterLogout.status, 401);
  assert.equal(afterLogout.status, 401);

  const reLogin = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-only-password-2026" })
  });
  assert.equal(reLogin.status, 200);
  cookie = (reLogin.headers.get("set-cookie") || "").split(";")[0];
  const freshSession = await request("/api/state");
  assert.deepEqual((await freshSession.json()).chats, []);
  const finalLogout = await request("/api/logout", { method: "POST", body: JSON.stringify({}) });
  assert.equal(finalLogout.status, 200);
  cookie = "";

});
