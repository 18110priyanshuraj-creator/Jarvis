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
import { createDevicesRouter } from "./routes/devices.js";
import { createAgentPlan } from "./services/agent-planner.js";
import { createConversationReply, isConversationAIEnabled } from "./services/conversation.js";
import { createGroundedResearch, isWebResearchEnabled, normalizeSavedResearch, shouldUseLiveWebResearch } from "./services/web-research.js";
import { getGeminiRuntimeStatus } from "./services/gemini-client.js";
import { buildKnowledgeContext, isDuplicateKnowledge, KNOWLEDGE_LIMITS, normalizeKnowledgeItem, searchKnowledgeItems } from "./services/knowledge.js";
import { buildMemoryContext, isDuplicateMemory, isSafeMemoryContent, MEMORY_LIMITS, normalizeMemory, searchMemories } from "./services/memory.js";
import { approveSkill, createSkillCandidate, createSkillVersion, getActiveSkillContext, normalizeSkill, pauseSkill, SKILL_LIMITS, validateSkill } from "./services/skill-engine.js";
import { EXPERIENCE_LIMITS, getActiveExperienceContext, normalizeExperienceFeedback, normalizeExperiencePreference, promoteFeedbackToPreference, setExperiencePreferenceActive, summarizeExperience } from "./services/experience.js";
import { advanceWorkflowRun, approveWorkflow, cancelWorkflowRun, createWorkflowDraft, createWorkflowRun, normalizeWorkflow, pauseWorkflow, updateWorkflowDraft, validateWorkflow, WORKFLOW_LIMITS } from "./services/workflow-engine.js";

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
const webResearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Web research rate limit reached. Please try again later." }
});
app.use("/api", apiLimiter);

let store = { memories: [], tasks: [], feedback: [], experiencePreferences: [], skills: [], workflows: [], workflowRuns: [], devices: [], research: [], knowledge: [] };
const sessionChats = new Map();
const MAX_EPHEMERAL_CHAT_MESSAGES = 32;
const EPHEMERAL_CHAT_TTL_MS = 60 * 60 * 1000;
let writeQueue = Promise.resolve();
let neonSql;

function getNeonSql() {
  if (!process.env.DATABASE_URL) return null;
  if (!neonSql) neonSql = neon(process.env.DATABASE_URL);
  return neonSql;
}

function normalizeStore(parsed = {}) {
  return {
    memories: Array.isArray(parsed.memories)
      ? parsed.memories.slice(-MEMORY_LIMITS.items).flatMap((item) => {
          try { return [normalizeMemory(item)]; } catch { return []; }
        })
      : [],
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.slice(-200) : [],
    // Never keep conversation prompts; retain only structured ratings and user-approved suggestions.
    feedback: Array.isArray(parsed.feedback)
      ? parsed.feedback.slice(-EXPERIENCE_LIMITS.feedback).flatMap((item) => {
          try { return [normalizeExperienceFeedback(item)]; } catch { return []; }
        })
      : [],
    experiencePreferences: Array.isArray(parsed.experiencePreferences)
      ? parsed.experiencePreferences.slice(-EXPERIENCE_LIMITS.preferences).flatMap((item) => {
          try { return [normalizeExperiencePreference(item)]; } catch { return []; }
        })
      : [],
    skills: Array.isArray(parsed.skills)
      ? parsed.skills.slice(-SKILL_LIMITS.skills).flatMap((item) => {
          try { return [normalizeSkill(item)]; } catch { return []; }
        })
      : [],
    workflows: Array.isArray(parsed.workflows)
      ? parsed.workflows.slice(-WORKFLOW_LIMITS.workflows).flatMap((item) => {
          try { return [normalizeWorkflow(item)]; } catch { return []; }
        })
      : [],
    workflowRuns: Array.isArray(parsed.workflowRuns)
      ? parsed.workflowRuns.slice(-WORKFLOW_LIMITS.runs).filter((item) =>
          item && typeof item.id === "string" && typeof item.workflowId === "string" &&
          Array.isArray(item.steps) && ["running", "waiting_review", "completed", "failed", "cancelled"].includes(item.status)
        )
      : [],
    devices: Array.isArray(parsed.devices) ? parsed.devices.slice(-50) : [],
    research: Array.isArray(parsed.research) ? parsed.research.slice(-50) : [],
    knowledge: Array.isArray(parsed.knowledge)
      ? parsed.knowledge.slice(-KNOWLEDGE_LIMITS.items).flatMap((item) => {
          try { return [normalizeKnowledgeItem(item)]; } catch { return []; }
        })
      : []
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
    if (token) {
      sessions.delete(token);
      sessionChats.delete("session:" + token);
    }
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
      // Remove legacy durable chat transcripts from the persistent snapshot.
      await saveStore();
      return;
    }
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
    // Rewrite legacy JSON state without conversation transcripts.
    await saveStore();
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

function getConversationMessages(key) {
  const now = Date.now();
  for (const [entryKey, entry] of sessionChats) {
    if (now - entry.updatedAt > EPHEMERAL_CHAT_TTL_MS) sessionChats.delete(entryKey);
  }
  let entry = sessionChats.get(key);
  if (!entry) {
    entry = { messages: [], updatedAt: now };
    sessionChats.set(key, entry);
  }
  entry.updatedAt = now;
  return entry.messages;
}

function appendConversationTurn(key, message, result) {
  const messages = getConversationMessages(key);
  const createdAt = new Date().toISOString();
  messages.push({ id: newId(), role: "user", content: message, createdAt });
  messages.push({
    id: newId(),
    role: "assistant",
    content: result.answer,
    engine: result.engine,
    sources: Array.isArray(result.sources) ? result.sources : [],
    citations: Array.isArray(result.citations) ? result.citations : [],
    createdAt: new Date().toISOString()
  });
  if (messages.length > MAX_EPHEMERAL_CHAT_MESSAGES) {
    messages.splice(0, messages.length - MAX_EPHEMERAL_CHAT_MESSAGES);
  }
}

function parseExplicitMemoryIntent(message) {
  const normalized = cleanText(message, 4000).replace(/^jarvis[,:]?\s*/i, "");
  const match = normalized.match(/^(?:please\s+)?remember(?:\s+that)?\s*[:,-]?\s*(.+)$/i) ||
    normalized.match(/^(?:please\s+)?(?:yaad\s+rakhna|is\s+baat\s+ko\s+yaad\s+rakhna)\s*[:,-]?\s*(.+)$/i);
  if (!match) return null;
  const content = cleanText(match[1], 500).replace(/[.!?]+$/, "").trim();
  if (!isSafeMemoryContent(content)) return { blocked: true };
  const lower = content.toLowerCase();
  const category = /\b(goal|aim|target|plan|want to|trying to)\b/.test(lower)
    ? "goal"
    : /\b(prefer|please use|explain|respond|answer|language|style|format)\b/.test(lower)
      ? "preference"
      : "fact";
  return { content, category, blocked: false };
}

async function processAssistantTurn(message, conversationKey) {
  const history = getConversationMessages(conversationKey)
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-8)
    .map(({ role, content }) => ({ role, content }));

  const memoryIntent = parseExplicitMemoryIntent(message);
  let result;
  if (memoryIntent?.blocked) {
    result = {
      answer: "I won't save that because it may contain a secret or sensitive personal information. Use the secure service directly instead.",
      engine: "privacy-guard",
      externalAI: false
    };
  } else if (memoryIntent) {
    const candidate = normalizeMemory({ content: memoryIntent.content, category: memoryIntent.category });
    const existing = store.memories.find((item) => isDuplicateMemory([item], candidate));
    if (existing) {
      result = { answer: "That preference or fact is already in your saved memory.", engine: "memory", externalAI: false };
    } else if (store.memories.length >= 200) {
      result = { answer: "Your memory list is full. Delete an old note before saving another.", engine: "memory", externalAI: false };
    } else {
      const memory = candidate;
      store.memories.push(memory);
      await saveStore();
      result = { answer: "I’ll remember this preference or fact because you explicitly asked me to. You can review or delete it in Memory.", engine: "memory", externalAI: false };
    }
  } else {
    result = await generateAssistantAnswer(message, history, store.memories);
  }

  appendConversationTurn(conversationKey, message, result);
  return result;
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

async function generateAssistantAnswer(message, history = [], memories = store.memories) {
  const useLiveWeb = shouldUseLiveWebResearch(message);
  let webNotice = "";

  if (useLiveWeb) {
    if (isWebResearchEnabled()) {
      try {
        const research = await createGroundedResearch(message);
        return { ...research, engine: "gemini-google-search", externalAI: true };
      } catch (error) {
        if (error?.code === "RESTRICTED_RESEARCH_QUERY") {
          return { answer: error.message, engine: "safety-filter", externalAI: false };
        }
        console.error("Automatic live web research failed:", error?.name || "Error");
        webNotice = "I could not verify this with live web sources right now. The answer below is not live-verified.";
      }
    } else {
      webNotice = "Live web search is currently disabled on the server, so this answer is not checked against current internet sources.";
    }
  }

  const conversationAIEnabled = isConversationAIEnabled();
  if (conversationAIEnabled) {
    try {
      const knowledgeContext = buildKnowledgeContext(store.knowledge, message, 3);
      const approvedMemoryContext = buildMemoryContext(memories, message, 5);
      const activeSkillContext = getActiveSkillContext(store.skills, message, 3);
      const approvedExperienceContext = getActiveExperienceContext(store.experiencePreferences, 5);
      const answer = await createConversationReply(message, history, approvedMemoryContext, knowledgeContext, activeSkillContext, approvedExperienceContext);
      return {
        answer: webNotice ? webNotice + "\n\n" + answer : answer,
        engine: "gemini-conversation",
        externalAI: true,
        liveWebChecked: false
      };
    } catch (error) {
      console.error("Gemini conversation failed; using the offline brain:", error?.name || "Error");
    }
  }

  const answer = runLocalBrain({
    message,
    memories: store.memories,
    tasks: store.tasks,
    skills: getActiveSkillContext(store.skills, message, 3),
    feedback: store.feedback,
    knowledge: buildKnowledgeContext(store.knowledge, message, 3)
  });
  return {
    answer: webNotice ? webNotice + "\n\n" + answer : answer,
    engine: conversationAIEnabled ? "built-in-offline-fallback" : "built-in-offline",
    externalAI: false,
    liveWebChecked: false
  };
}

app.get("/api/health", (_req, res) => {
  const gemini = getGeminiRuntimeStatus();
  const conversationAIEnabled = gemini.conversationEnabled;
  const plannerAIEnabled = gemini.plannerEnabled;
  const webResearchEnabled = gemini.webResearchEnabled;
  res.json({
    ok: true,
    service: "jarvis",
    version: "1.3.0-workflow-execution",
    brain: conversationAIEnabled ? "gemini-conversation-with-offline-fallback" : "built-in-offline-rules",
    plannerAIEnabled,
    conversationAIEnabled,
    webResearchEnabled,
    externalAI: plannerAIEnabled || conversationAIEnabled || webResearchEnabled,
    aiProvider: {
      provider: gemini.provider,
      configured: gemini.configured,
      model: gemini.model,
      modelValid: gemini.modelValid,
      requestTimeoutMs: gemini.requestTimeoutMs,
      retryAttempts: gemini.retryAttempts
    }
  });
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
  sessionChats.delete("session:" + req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/session", requireAuth, (_req, res) => {
  res.json({ authenticated: true });
});

app.get("/api/state", requireAuth, (req, res) => {
  res.json({
    chats: getConversationMessages("session:" + req.sessionToken),
    memories: store.memories,
    tasks: store.tasks.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    feedback: store.feedback.slice(-100),
    experiencePreferences: store.experiencePreferences,
    skills: store.skills,
    workflows: store.workflows,
    workflowRuns: store.workflowRuns.slice().reverse().slice(0, 50),
    research: store.research.slice().reverse()
  });
});

app.delete("/api/chat/history", requireAuth, (req, res) => {
  sessionChats.delete("session:" + req.sessionToken);
  res.json({ ok: true });
});

app.get("/api/export", requireAuth, (req, res) => {
  const payload = {
    format: "jarvis-personal-data",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      memories: store.memories,
      knowledge: store.knowledge,
      research: store.research,
      tasks: store.tasks,
      feedback: store.feedback,
      experiencePreferences: store.experiencePreferences,
      skills: store.skills,
      workflows: store.workflows,
      workflowRuns: store.workflowRuns
    },
    excluded: [
      "temporary conversation history",
      "device credentials and pairing records",
      "server environment variables and API credentials",
      "chat prompts and assistant replies are not stored as feedback records"
    ]
  };
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", 'attachment; filename="jarvis-personal-data.json"');
  res.json(payload);
});

app.post("/api/chat", requireAuth, async (req, res) => {
  const message = cleanText(req.body?.message, 4000);
  if (!message) return res.status(400).json({ error: "Enter a message first." });
  try {
    const result = await processAssistantTurn(message, "session:" + req.sessionToken);
    res.json(result);
  } catch (error) {
    console.error("Assistant reply failed:", error?.name || "Error");
    res.status(500).json({ error: "JARVIS could not process this request. Please try again." });
  }
});

app.get("/api/memories", requireAuth, (req, res) => {
  const query = cleanText(req.query.q, 300);
  const category = cleanText(req.query.category, 30);
  const requestedLimit = Number.parseInt(String(req.query.limit || "100"), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 100;
  const items = searchMemories(store.memories, query, category, limit);
  res.json({ query, category, total: store.memories.length, count: items.length, items });
});

app.post("/api/memories", requireAuth, async (req, res) => {
  let memory;
  try {
    memory = normalizeMemory(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Memory is invalid." });
  }

  const duplicate = store.memories.find((item) => isDuplicateMemory([item], memory));
  if (duplicate) return res.status(200).json({ memory: duplicate, duplicate: true });
  if (store.memories.length >= MEMORY_LIMITS.items) {
    return res.status(409).json({ error: "Memory limit reached. Delete an old note first." });
  }

  store.memories.push(memory);
  await saveStore();
  res.status(201).json({ memory, duplicate: false });
});

app.patch("/api/memories/:id", requireAuth, async (req, res) => {
  const existing = store.memories.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Memory not found." });

  let updated;
  try {
    updated = normalizeMemory({
      ...existing,
      content: typeof req.body?.content === "string" ? req.body.content : existing.content,
      category: typeof req.body?.category === "string" ? req.body.category : existing.category,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Memory is invalid." });
  }

  const duplicate = store.memories.find((item) =>
    item.id !== existing.id && isDuplicateMemory([item], updated)
  );
  if (duplicate) return res.status(409).json({ error: "Another saved memory already contains the same note." });

  store.memories = store.memories.map((item) => item.id === existing.id ? updated : item);
  await saveStore();
  res.json({ memory: updated });
});

app.delete("/api/memories/:id", requireAuth, async (req, res) => {
  const before = store.memories.length;
  store.memories = store.memories.filter((item) => item.id !== req.params.id);
  if (store.memories.length === before) return res.status(404).json({ error: "Memory not found." });
  await saveStore();
  res.json({ ok: true });
});

app.get("/api/experience", requireAuth, (_req, res) => {
  res.json({
    summary: summarizeExperience(store.feedback, store.experiencePreferences),
    feedback: store.feedback.slice().reverse(),
    preferences: store.experiencePreferences.slice().reverse()
  });
});

app.post("/api/feedback", requireAuth, async (req, res) => {
  let item;
  try {
    // The legacy prompt field is accepted for client compatibility but is never persisted.
    item = normalizeExperienceFeedback({
      rating: req.body?.rating,
      category: req.body?.category,
      suggestion: req.body?.suggestion,
      engine: req.body?.engine,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Feedback is invalid." });
  }
  if (store.feedback.length >= EXPERIENCE_LIMITS.feedback) {
    store.feedback = store.feedback.slice(-(EXPERIENCE_LIMITS.feedback - 1));
  }
  store.feedback.push(item);
  await saveStore();
  res.status(201).json({ feedback: item });
});

app.post("/api/feedback/:id/approve", requireAuth, async (req, res) => {
  const existing = store.feedback.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Feedback entry not found." });
  try {
    const result = promoteFeedbackToPreference(existing, store.experiencePreferences);
    store.experiencePreferences.push(result.preference);
    store.feedback = store.feedback.map((item) => item.id === existing.id ? result.feedback : item);
    await saveStore();
    res.status(201).json({ preference: result.preference, feedback: result.feedback });
  } catch (error) {
    res.status(409).json({ error: error.message || "Feedback cannot be approved as a preference." });
  }
});

app.patch("/api/experience/preferences/:id", requireAuth, async (req, res) => {
  const existing = store.experiencePreferences.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Response preference not found." });
  let updated;
  try {
    updated = setExperiencePreferenceActive(existing, req.body?.active);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Preference update is invalid." });
  }
  store.experiencePreferences = store.experiencePreferences.map((item) => item.id === existing.id ? updated : item);
  await saveStore();
  res.json({ preference: updated });
});

app.delete("/api/experience/preferences/:id", requireAuth, async (req, res) => {
  const before = store.experiencePreferences.length;
  store.experiencePreferences = store.experiencePreferences.filter((item) => item.id !== req.params.id);
  if (before === store.experiencePreferences.length) return res.status(404).json({ error: "Response preference not found." });
  // Keep its source feedback as a reviewed record; deleting a preference does not delete feedback.
  await saveStore();
  res.json({ ok: true });
});

app.delete("/api/feedback/:id", requireAuth, async (req, res) => {
  const before = store.feedback.length;
  const existing = store.feedback.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Feedback entry not found." });
  store.feedback = store.feedback.filter((item) => item.id !== req.params.id);
  // The user may delete feedback independently; an already approved preference remains separate.
  await saveStore();
  res.json({ ok: true });
});

app.get("/api/skills", requireAuth, (_req, res) => {
  res.json({ skills: store.skills, total: store.skills.length });
});

app.get("/api/skills/:id/versions", requireAuth, (req, res) => {
  const skill = store.skills.find((item) => item.id === req.params.id);
  if (!skill) return res.status(404).json({ error: "Skill not found." });
  res.json({
    id: skill.id,
    currentVersion: skill.currentVersion,
    activeVersion: skill.activeVersion,
    versions: skill.versions
  });
});

app.post("/api/skills", requireAuth, async (req, res) => {
  let skill;
  try {
    skill = createSkillCandidate(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Skill candidate is invalid." });
  }
  if (store.skills.length >= SKILL_LIMITS.skills) {
    return res.status(409).json({ error: "Skill limit reached. Remove an old skill first." });
  }
  const duplicate = store.skills.find((item) => item.name.toLocaleLowerCase() === skill.name.toLocaleLowerCase());
  if (duplicate) return res.status(409).json({ error: "A skill with this name already exists. Edit the existing skill to create a new version." });
  store.skills.push(skill);
  await saveStore();
  res.status(201).json({ skill });
});

app.patch("/api/skills/:id", requireAuth, async (req, res) => {
  const existing = store.skills.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Skill not found." });
  let updated;
  try {
    updated = createSkillVersion(existing, req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Skill version is invalid." });
  }
  store.skills = store.skills.map((item) => item.id === existing.id ? updated : item);
  await saveStore();
  res.json({ skill: updated });
});

app.post("/api/skills/:id/validate", requireAuth, async (req, res) => {
  const existing = store.skills.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Skill not found." });
  const result = validateSkill(existing);
  store.skills = store.skills.map((item) => item.id === existing.id ? result.skill : item);
  await saveStore();
  res.json({ skill: result.skill, validation: result.validation });
});

app.post("/api/skills/:id/approve", requireAuth, async (req, res) => {
  const existing = store.skills.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Skill not found." });
  let approved;
  try {
    approved = approveSkill(existing);
  } catch (error) {
    return res.status(409).json({ error: error.message || "Skill cannot be approved." });
  }
  store.skills = store.skills.map((item) => item.id === existing.id ? approved : item);
  await saveStore();
  res.json({ skill: approved });
});

app.post("/api/skills/:id/pause", requireAuth, async (req, res) => {
  const existing = store.skills.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Skill not found." });
  const paused = pauseSkill(existing);
  store.skills = store.skills.map((item) => item.id === existing.id ? paused : item);
  await saveStore();
  res.json({ skill: paused });
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

app.get("/api/workflows", requireAuth, (_req, res) => {
  res.json({
    workflows: store.workflows.slice().reverse(),
    runs: store.workflowRuns.slice().reverse().slice(0, 50),
    limits: WORKFLOW_LIMITS
  });
});

app.post("/api/workflows", requireAuth, async (req, res) => {
  let workflow;
  try {
    workflow = createWorkflowDraft(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Workflow draft is invalid." });
  }
  if (store.workflows.length >= WORKFLOW_LIMITS.workflows) {
    return res.status(409).json({ error: "Workflow limit reached. Delete an older workflow first." });
  }
  if (store.workflows.some((item) => item.name.toLocaleLowerCase() === workflow.name.toLocaleLowerCase())) {
    return res.status(409).json({ error: "A workflow with this name already exists. Edit it to create a new version." });
  }
  store.workflows.push(workflow);
  await saveStore();
  res.status(201).json({ workflow });
});

app.patch("/api/workflows/:id", requireAuth, async (req, res) => {
  const existing = store.workflows.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Workflow not found." });
  if (store.workflowRuns.some((run) => run.workflowId === existing.id && ["running", "waiting_review"].includes(run.status))) {
    return res.status(409).json({ error: "Stop or finish the active run before editing this workflow." });
  }
  let updated;
  try {
    updated = updateWorkflowDraft(existing, req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Workflow update is invalid." });
  }
  store.workflows = store.workflows.map((item) => item.id === existing.id ? updated : item);
  await saveStore();
  res.json({ workflow: updated });
});

app.post("/api/workflows/:id/validate", requireAuth, async (req, res) => {
  const existing = store.workflows.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Workflow not found." });
  const result = validateWorkflow(existing);
  store.workflows = store.workflows.map((item) => item.id === existing.id ? result.workflow : item);
  await saveStore();
  res.json({ workflow: result.workflow, validation: result.validation });
});

app.post("/api/workflows/:id/approve", requireAuth, async (req, res) => {
  const existing = store.workflows.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Workflow not found." });
  let approved;
  try {
    approved = approveWorkflow(existing);
  } catch (error) {
    return res.status(409).json({ error: error.message || "Workflow cannot be approved." });
  }
  store.workflows = store.workflows.map((item) => item.id === existing.id ? approved : item);
  await saveStore();
  res.json({ workflow: approved });
});

app.post("/api/workflows/:id/pause", requireAuth, async (req, res) => {
  const existing = store.workflows.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Workflow not found." });
  if (store.workflowRuns.some((run) => run.workflowId === existing.id && ["running", "waiting_review"].includes(run.status))) {
    return res.status(409).json({ error: "Stop the active run before pausing this workflow." });
  }
  let paused;
  try {
    paused = pauseWorkflow(existing);
  } catch (error) {
    return res.status(409).json({ error: error.message || "Workflow cannot be paused." });
  }
  store.workflows = store.workflows.map((item) => item.id === existing.id ? paused : item);
  await saveStore();
  res.json({ workflow: paused });
});

app.delete("/api/workflows/:id", requireAuth, async (req, res) => {
  const existing = store.workflows.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Workflow not found." });
  if (store.workflowRuns.some((run) => run.workflowId === existing.id && ["running", "waiting_review"].includes(run.status))) {
    return res.status(409).json({ error: "Stop the active run before deleting this workflow." });
  }
  store.workflows = store.workflows.filter((item) => item.id !== existing.id);
  await saveStore();
  res.json({ ok: true });
});

function workflowStepHandlers() {
  return {
    create_task: async (step) => {
      if (store.tasks.length >= 200) throw new Error("Task limit reached. Remove an old task first.");
      const task = {
        id: newId(),
        title: step.title,
        description: step.description || "",
        dueAt: "",
        done: false,
        createdAt: new Date().toISOString()
      };
      store.tasks.push(task);
      return { taskId: task.id, summary: "Task created: " + task.title };
    },
    save_memory: async (step) => {
      const memory = normalizeMemory({ content: step.content, category: step.category });
      if (isDuplicateMemory(store.memories, memory)) {
        return { duplicate: true, summary: "That memory is already saved." };
      }
      if (store.memories.length >= MEMORY_LIMITS.items) throw new Error("Memory limit reached.");
      store.memories.push(memory);
      return { memoryId: memory.id, summary: "Memory saved: " + memory.content.slice(0, 120) };
    },
    search_knowledge: async (step) => {
      const results = searchKnowledgeItems(store.knowledge, step.query, 5).map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        reviewStatus: item.reviewStatus,
        snippet: item.content.slice(0, 350)
      }));
      return { results, summary: results.length + " saved knowledge result(s) found." };
    },
    draft_text: async (step) => ({
      draft: step.content,
      summary: "Draft prepared locally. Nothing was sent or published."
    })
  };
}

app.post("/api/workflows/:id/run", requireAuth, async (req, res) => {
  const workflow = store.workflows.find((item) => item.id === req.params.id);
  if (!workflow) return res.status(404).json({ error: "Workflow not found." });
  if (workflow.status !== "approved" || !workflow.approvedAt) {
    return res.status(409).json({ error: "Validate and approve this workflow before running it." });
  }
  if (store.workflowRuns.some((run) => run.workflowId === workflow.id && ["running", "waiting_review"].includes(run.status))) {
    return res.status(409).json({ error: "This workflow already has an active run. Continue or stop it first." });
  }
  if (store.workflowRuns.length >= WORKFLOW_LIMITS.runs) {
    store.workflowRuns = store.workflowRuns.filter((run) => ["running", "waiting_review"].includes(run.status))
      .concat(store.workflowRuns.filter((run) => !["running", "waiting_review"].includes(run.status)).slice(-(WORKFLOW_LIMITS.runs - 1)));
  }
  const run = createWorkflowRun(workflow);
  store.workflowRuns.push(run);
  const result = await advanceWorkflowRun(run, workflowStepHandlers());
  store.workflowRuns = store.workflowRuns.map((item) => item.id === run.id ? result : item);
  await saveStore();
  res.status(201).json({ run: result });
});

app.post("/api/workflow-runs/:id/continue", requireAuth, async (req, res) => {
  const existing = store.workflowRuns.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Workflow run not found." });
  if (existing.status !== "waiting_review") {
    return res.status(409).json({ error: "This run is not waiting for your review." });
  }
  const continued = { ...existing, status: "running", updatedAt: new Date().toISOString() };
  const result = await advanceWorkflowRun(continued, workflowStepHandlers());
  store.workflowRuns = store.workflowRuns.map((item) => item.id === existing.id ? result : item);
  await saveStore();
  res.json({ run: result });
});

app.post("/api/workflow-runs/:id/stop", requireAuth, async (req, res) => {
  const existing = store.workflowRuns.find((item) => item.id === req.params.id);
  if (!existing) return res.status(404).json({ error: "Workflow run not found." });
  let cancelled;
  try {
    cancelled = cancelWorkflowRun(existing);
  } catch (error) {
    return res.status(409).json({ error: error.message || "Workflow run cannot be stopped." });
  }
  store.workflowRuns = store.workflowRuns.map((item) => item.id === existing.id ? cancelled : item);
  await saveStore();
  res.json({ run: cancelled });
});

app.get("/api/search", requireAuth, (req, res) => {
  const query = cleanText(req.query.q, 300);
  if (!query) return res.status(400).json({ error: "Enter a search query." });

  const savedResults = searchKnowledgeItems(store.knowledge, query, 8).map((item) => ({
    id: item.id,
    title: item.title,
    snippet: item.content.slice(0, 700),
    category: item.category,
    source: "saved-knowledge",
    reviewStatus: item.reviewStatus,
    sources: item.sources
  }));
  const offlineResults = searchLocalKnowledge(query, 8).map((item) => ({
    title: item.title,
    snippet: item.snippet,
    source: "embedded-local-knowledge",
    score: item.score,
    sources: []
  }));
  const results = [...savedResults, ...offlineResults]
    .sort((a, b) => (b.score || (b.source === "saved-knowledge" ? 10 : 0)) - (a.score || (a.source === "saved-knowledge" ? 10 : 0)))
    .slice(0, 10);

  res.json({ query, results, source: "saved-and-embedded-knowledge", externalSearch: false });
});

app.get("/api/knowledge", requireAuth, (req, res) => {
  const query = cleanText(req.query.q, 300);
  const requestedLimit = Number.parseInt(String(req.query.limit || "100"), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 100;
  const items = searchKnowledgeItems(store.knowledge, query, limit);
  res.json({ query, total: store.knowledge.length, count: items.length, items });
});

app.post("/api/knowledge", requireAuth, async (req, res) => {
  let item;
  try {
    item = normalizeKnowledgeItem(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Knowledge entry is invalid." });
  }

  const duplicate = store.knowledge.find((existing) => isDuplicateKnowledge([existing], item));
  if (duplicate) return res.status(200).json({ item: duplicate, duplicate: true });

  if (store.knowledge.length >= KNOWLEDGE_LIMITS.items) {
    return res.status(409).json({ error: "Knowledge library is full. Delete an old entry before adding another." });
  }

  store.knowledge.push(item);
  await saveStore();
  res.status(201).json({ item, duplicate: false });
});

app.patch("/api/knowledge/:id", requireAuth, async (req, res) => {
  const item = store.knowledge.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Knowledge entry not found." });
  if (item.sourceKind !== "web-research" || req.body?.reviewStatus !== "user-reviewed") {
    return res.status(400).json({ error: "Only saved web research can be marked as reviewed after you check its sources." });
  }

  const updated = normalizeKnowledgeItem({
    ...item,
    reviewStatus: "user-reviewed",
    updatedAt: new Date().toISOString()
  });
  store.knowledge = store.knowledge.map((entry) => entry.id === item.id ? updated : entry);
  await saveStore();
  res.json({ item: updated });
});

app.delete("/api/knowledge/:id", requireAuth, async (req, res) => {
  const before = store.knowledge.length;
  store.knowledge = store.knowledge.filter((entry) => entry.id !== req.params.id);
  if (store.knowledge.length === before) return res.status(404).json({ error: "Knowledge entry not found." });
  await saveStore();
  res.json({ ok: true });
});

app.post("/api/research", requireAuth, webResearchLimiter, async (req, res) => {
  const query = cleanText(req.body?.query, 1200);
  if (!query) return res.status(400).json({ error: "Enter a research question first." });
  if (!isWebResearchEnabled()) {
    return res.status(503).json({
      error: "Live web research is disabled. Configure GEMINI_API_KEY and GEMINI_WEB_RESEARCH_ENABLED=true on the server."
    });
  }

  try {
    const result = await createGroundedResearch(query);
    res.json(result);
  } catch (error) {
    if (error?.code === "RESTRICTED_RESEARCH_QUERY") {
      return res.status(400).json({ error: error.message });
    }
    console.error("Grounded web research failed:", error?.name || "Error");
    res.status(502).json({ error: "Live web research could not complete this request. Please try again later." });
  }
});

app.post("/api/research/saved", requireAuth, async (req, res) => {
  let normalized;
  try {
    normalized = normalizeSavedResearch(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Saved research is invalid." });
  }

  if (store.research.length >= 50) {
    return res.status(409).json({ error: "Saved research limit reached. Delete an older saved item first." });
  }

  const item = {
    id: newId(),
    ...normalized,
    createdAt: new Date().toISOString()
  };
  store.research.push(item);
  await saveStore();
  res.status(201).json({ item });
});

app.delete("/api/research/saved/:id", requireAuth, async (req, res) => {
  const before = store.research.length;
  store.research = store.research.filter((item) => item.id !== req.params.id);
  if (store.research.length === before) return res.status(404).json({ error: "Saved research item not found." });
  await saveStore();
  res.json({ ok: true });
});


async function runDeviceVoiceCommand(message, device = {}) {
  const deviceKey = "device:" + (device.id || "unpaired");
  try {
    return await processAssistantTurn(message, deviceKey);
  } catch (error) {
    console.error("Device voice command failed:", error?.name || "Error");
    throw new Error("The JARVIS assistant could not process this voice request.");
  }
}

app.use("/api/devices", createDevicesRouter({ getStore: () => store, saveStore, requireAuth, runDeviceVoiceCommand, createAgentPlan }));

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
