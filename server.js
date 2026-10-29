import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { neon } from "@neondatabase/serverless";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { runLocalBrain, searchLocalKnowledge } from "./brain.js";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.JARVIS_PASSWORD || "";
const DATA_DIR = path.resolve(process.env.JARVIS_DATA_DIR || path.join(__dirname, "data"));
const STORE_FILE = path.join(DATA_DIR, "state.json");
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

if (process.env.NODE_ENV === "production" && !PASSWORD) {
  console.error("JARVIS_PASSWORD is required in production. Set it in the host's environment settings.");
  process.exit(1);
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "1mb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 180,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait and try again." }
});
app.use("/api", apiLimiter);

let store = { chats: [], memories: [], tasks: [], feedback: [], skills: [] };
let writeQueue = Promise.resolve();
let neonSql;

function getNeonSql() {
  if (!process.env.DATABASE_URL) return null;
  if (!neonSql) neonSql = neon(process.env.DATABASE_URL);
  return neonSql;
}

function normalizeStore(parsed = {}) {
  return {
    chats: Array.isArray(parsed.chats) ? parsed.chats.slice(-100) : [],
    memories: Array.isArray(parsed.memories) ? parsed.memories.slice(-200) : [],
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.slice(-200) : [],
    feedback: Array.isArray(parsed.feedback) ? parsed.feedback.slice(-300) : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills.slice(-100) : []
  };
}

function newId() {
  return crypto.randomUUID();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function passwordsMatch(candidate, expected) {
  return crypto.timingSafeEqual(sha256(candidate), sha256(expected));
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { /* ignore malformed cookies */ }
  }
  return out;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", "jarvis_session=" + encodeURIComponent(token) +
    "; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200" + secure);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", "jarvis_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" + secure);
}

function requireAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie).jarvis_session;
  const session = token ? sessions.get(token) : null;
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  req.sessionToken = token;
  next();
}

app.use("/api", (req, res, next) => {
  const hasBody = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const origin = req.get("origin");
  if (hasBody && origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        return res.status(403).json({ error: "Cross-origin request blocked." });
      }
    } catch {
      return res.status(403).json({ error: "Invalid request origin." });
    }
  }
  next();
});

async function loadStore() {
  const sql = getNeonSql();
  if (sql) {
    await sql`CREATE TABLE IF NOT EXISTS jarvis_app_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    const rows = await sql`SELECT state FROM jarvis_app_state WHERE id = 1 LIMIT 1`;
    if (rows.length > 0) {
      const saved = typeof rows[0].state === "string" ? JSON.parse(rows[0].state) : rows[0].state;
      store = normalizeStore(saved);
      return;
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    let initial = store;
    try {
      initial = normalizeStore(JSON.parse(await fs.readFile(STORE_FILE, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error("Could not read saved JARVIS data. Check " + STORE_FILE + " before migrating to PostgreSQL.");
      }
    }
    store = initial;
    const snapshot = JSON.stringify(store);
    await sql`INSERT INTO jarvis_app_state (id, state, updated_at) VALUES (1, ${snapshot}::jsonb, now()) ON CONFLICT (id) DO NOTHING`;
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    store = normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Could not read saved JARVIS data. Check " + STORE_FILE + " before restarting.");
    await saveStore();
  }
}

function saveStore() {
  const snapshot = JSON.stringify(store, null, 2) + "\n";
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    const sql = getNeonSql();
    if (sql) {
      const databaseSnapshot = JSON.stringify(store);
      await sql`INSERT INTO jarvis_app_state (id, state, updated_at) VALUES (1, ${databaseSnapshot}::jsonb, now()) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`;
      return;
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tempFile = STORE_FILE + ".tmp";
    await fs.writeFile(tempFile, snapshot, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tempFile, STORE_FILE);
  });
  return writeQueue;
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "jarvis", version: "0.2.0", brain: "built-in-offline-rules", externalAI: false });
});

app.post("/api/login", loginLimiter, (req, res) => {
  const candidate = cleanText(req.body?.password, 500);
  if (!PASSWORD || !candidate || !passwordsMatch(candidate, PASSWORD)) {
    return res.status(401).json({ error: "Incorrect password or server password is not configured." });
  }
  for (const [sessionId, session] of sessions) {
    if (session.expiresAt <= Date.now()) sessions.delete(sessionId);
  }
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS });
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post("/api/logout", requireAuth, (req, res) => {
  sessions.delete(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/session", requireAuth, (_req, res) => {
  res.json({ authenticated: true });
});

app.get("/api/state", requireAuth, (_req, res) => {
  res.json({
    chats: store.chats.slice(-60),
    memories: store.memories,
    tasks: store.tasks.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    feedback: store.feedback.slice(-100),
    skills: store.skills
  });
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const message = cleanText(req.body?.message, 4000);
  if (!message) return res.status(400).json({ error: "Enter a message first." });

  store.chats.push({ id: newId(), role: "user", content: message, createdAt: new Date().toISOString() });
  store.chats = store.chats.slice(-100);
  await saveStore();

  // The built-in brain is deterministic and self-contained: no model server,
  // external inference URL, API key, or outbound network request is used here.
  let answer;
  try {
    answer = runLocalBrain({
      message,
      memories: store.memories,
      tasks: store.tasks,
      skills: store.skills,
      feedback: store.feedback
    });
  } catch (error) {
    console.error("Built-in brain failed:", error?.name || "Error");
    return res.status(500).json({ error: "The built-in offline brain encountered an internal error." });
  }

  store.chats.push({ id: newId(), role: "assistant", content: answer, createdAt: new Date().toISOString() });
  store.chats = store.chats.slice(-100);
  await saveStore();
  res.json({ answer, engine: "built-in-offline", externalAI: false });
});

app.post("/api/memories", requireAuth, async (req, res) => {
  const content = cleanText(req.body?.content, 1000);
  const allowed = ["preference", "goal", "fact"];
  const category = allowed.includes(req.body?.category) ? req.body.category : "fact";
  if (!content) return res.status(400).json({ error: "Memory text cannot be empty." });
  if (store.memories.length >= 200) return res.status(409).json({ error: "Memory limit reached. Delete an old note first." });
  const memory = { id: newId(), content, category, createdAt: new Date().toISOString() };
  store.memories.push(memory);
  await saveStore();
  res.status(201).json({ memory });
});

app.delete("/api/memories/:id", requireAuth, async (req, res) => {
  const before = store.memories.length;
  store.memories = store.memories.filter((m) => m.id !== req.params.id);
  if (store.memories.length === before) return res.status(404).json({ error: "Memory not found." });
  await saveStore();
  res.json({ ok: true });
});

app.post("/api/feedback", requireAuth, async (req, res) => {
  const prompt = cleanText(req.body?.prompt, 1000);
  const rating = req.body?.rating === "up" ? "up" : req.body?.rating === "down" ? "down" : "";
  const note = cleanText(req.body?.note, 500);
  if (!prompt || !rating) return res.status(400).json({ error: "Feedback needs a prompt and an up/down rating." });
  if (store.feedback.length >= 300) store.feedback = store.feedback.slice(-250);
  const item = { id: newId(), prompt, rating, note, createdAt: new Date().toISOString() };
  store.feedback.push(item);
  await saveStore();
  res.status(201).json({ feedback: item });
});

app.delete("/api/feedback/:id", requireAuth, async (req, res) => {
  const before = store.feedback.length;
  store.feedback = store.feedback.filter((item) => item.id !== req.params.id);
  if (before === store.feedback.length) return res.status(404).json({ error: "Feedback entry not found." });
  await saveStore();
  res.json({ ok: true });
});

app.post("/api/skills", requireAuth, async (req, res) => {
  const name = cleanText(req.body?.name, 80);
  const instructions = cleanText(req.body?.instructions, 1200);
  if (!name || !instructions) return res.status(400).json({ error: "Skill name and instructions are required." });
  if (store.skills.length >= 100) return res.status(409).json({ error: "Skill limit reached. Remove an old skill first." });
  const skill = { id: newId(), name, instructions, createdAt: new Date().toISOString() };
  store.skills.push(skill);
  await saveStore();
  res.status(201).json({ skill });
});

app.delete("/api/skills/:id", requireAuth, async (req, res) => {
  const before = store.skills.length;
  store.skills = store.skills.filter((skill) => skill.id !== req.params.id);
  if (before === store.skills.length) return res.status(404).json({ error: "Skill not found." });
  await saveStore();
  res.json({ ok: true });
});

app.post("/api/tasks", requireAuth, async (req, res) => {
  const title = cleanText(req.body?.title, 180);
  const description = cleanText(req.body?.description, 1000);
  const dueAt = cleanText(req.body?.dueAt, 80);
  if (!title) return res.status(400).json({ error: "Task title cannot be empty." });
  if (store.tasks.length >= 200) return res.status(409).json({ error: "Task limit reached. Remove an old task first." });
  const task = { id: newId(), title, description, dueAt, done: false, createdAt: new Date().toISOString() };
  store.tasks.push(task);
  await saveStore();
  res.status(201).json({ task });
});

app.patch("/api/tasks/:id", requireAuth, async (req, res) => {
  const task = store.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found." });
  if (typeof req.body?.done === "boolean") task.done = req.body.done;
  if (typeof req.body?.title === "string") task.title = cleanText(req.body.title, 180) || task.title;
  await saveStore();
  res.json({ task });
});

app.delete("/api/tasks/:id", requireAuth, async (req, res) => {
  const before = store.tasks.length;
  store.tasks = store.tasks.filter((task) => task.id !== req.params.id);
  if (store.tasks.length === before) return res.status(404).json({ error: "Task not found." });
  await saveStore();
  res.json({ ok: true });
});

app.get("/api/search", requireAuth, (req, res) => {
  const query = cleanText(req.query.q, 300);
  if (!query) return res.status(400).json({ error: "Enter a search query." });
  const results = searchLocalKnowledge(query, 8).map((item) => ({
    title: item.title,
    snippet: item.snippet,
    url: ""
  }));
  res.json({ query, results, source: "embedded-local-knowledge", externalSearch: false });
});

app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((error, _req, res, _next) => {
  console.error("Unhandled request error:", error?.message || "unknown");
  if (res.headersSent) return;
  res.status(500).json({ error: "Unexpected server error. Check the server logs." });
});

await loadStore();
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("JARVIS listening on port " + PORT);
});
server.requestTimeout = 95000;
