import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { neon } from "@neondatabase/serverless";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { runLocalBrain, searchLocalKnowledge } from "./brain.js";
import { getIntelligenceStatus, resolveOfflineAssistantTurn } from "./services/intelligence-engine.js";
import { classifyIntent } from "./services/nlu.js";
import { fileURLToPath } from "node:url";
import { createDevicesRouter } from "./routes/devices.js";
import { createRuntimeStore } from "./services/runtime-store.js";
import { createAgentPlan } from "./services/agent-planner.js";
import { createConversationReply, isConversationAIEnabled } from "./services/conversation.js";
import { createWebResearch, getWebResearchStatus, isRestrictedResearchQuery, isWebResearchEnabled, normalizeSavedResearch, shouldUseLiveWebResearch } from "./services/web-research.js";
import { createPageReadToken, createWebPageRead, getWebPageReadStatus, verifyPageReadToken } from "./services/web-page-reader.js";
import { createSourceBasedAnswer, SOURCE_ANSWER_LIMITS } from "./services/source-answer.js";
import { getAIProviderStatus } from "./services/ai-provider.js";
import { buildKnowledgeContext, isDuplicateKnowledge, KNOWLEDGE_LIMITS, mergeDuplicateKnowledge, normalizeKnowledgeItem, searchKnowledgeItems } from "./services/knowledge.js";
import { buildMemoryContext, findExactMemory, isDuplicateMemory, isSafeMemoryContent, MEMORY_LIMITS, normalizeMemory, parseExplicitForgetIntent, previewMemoryContext, searchMemories } from "./services/memory.js";
import { approveSkill, createSkillCandidate, createSkillVersion, getActiveSkillContext, normalizeSkill, pauseSkill, SKILL_LIMITS, validateSkill } from "./services/skill-engine.js";
import { EXPERIENCE_LIMITS, getActiveExperienceContext, normalizeExperienceFeedback, normalizeExperiencePreference, promoteFeedbackToPreference, setExperiencePreferenceActive, summarizeExperience } from "./services/experience.js";
import { advanceWorkflowRun, approveWorkflow, cancelWorkflowRun, createWorkflowDraft, createWorkflowRun, normalizeWorkflow, pauseWorkflow, updateWorkflowDraft, validateWorkflow, WORKFLOW_LIMITS } from "./services/workflow-engine.js";
import { getIntegrationCatalog, INTEGRATION_PROVIDER_IDS, probeIntegration, runIntegrationAction } from "./services/integrations.js";
import { appendActionStatus, createPendingExternalAction, executeExternalAction, getExternalActionCapabilities, MAX_ACTION_HISTORY, MAX_PENDING_ACTIONS, normalizeExternalAction } from "./services/external-actions.js";
import {
  beginGoogleOAuth,
  consumeGoogleOAuthBrowserHandoff,
  createGoogleOAuthBrowserHandoff,
  clearGoogleDriveTokenCache,
  finishGoogleOAuth,
  getGoogleDriveAccessToken,
  getGoogleOAuthStatus,
  getIntegrationPermissionCatalog,
  normalizeGoogleOAuthConnection,
  revokeGoogleOAuthConnection
} from "./services/oauth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.JARVIS_PASSWORD || "";
const DATA_DIR = path.resolve(process.env.JARVIS_DATA_DIR || path.join(__dirname, "data"));
const STORE_FILE = path.join(DATA_DIR, "state.json");
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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
const pageReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Full-page reading rate limit reached. Please try again later." }
});
const sourceAnswerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Source-based answer limit reached. Please try again later." }
});
const integrationTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Integration test limit reached. Please try again later." }
});

const diagnosticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "System diagnostics are temporarily rate limited. Try again later." }
});
const actionPreviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Action preview limit reached. Try again later." }
});
const actionConfirmLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Action confirmation limit reached. Try again later." }
});
const oauthStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "OAuth connection attempts are temporarily limited. Try again later." }
});
const oauthCallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const oauthLaunchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "OAuth browser launch limit reached. Start a new connection from JARVIS." }
});


app.use("/api", apiLimiter);

let store = { memories: [], tasks: [], feedback: [], experiencePreferences: [], skills: [], workflows: [], workflowRuns: [], disabledIntegrations: [], oauthConnections: [], externalActions: [], devices: [], research: [], knowledge: [] };
let writeQueue = Promise.resolve();
let neonSql;
let databaseRevision = null;
let databaseBaseStore = null;

function getNeonSql() {
  if (!process.env.DATABASE_URL) return null;
  if (!neonSql) neonSql = neon(process.env.DATABASE_URL);
  return neonSql;
}

const runtimeStore = createRuntimeStore({ getSql: getNeonSql });

function cloneStore(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function storeItemIdentity(item) {
  if (typeof item === "string") return "string:" + item;
  if (!item || typeof item !== "object") return null;
  if (typeof item.id === "string" && item.id) return "id:" + item.id;
  if (typeof item.provider === "string" && item.provider) return "provider:" + item.provider;
  return null;
}

function mergeStoreArray(base, local, latest) {
  if ([...base, ...local, ...latest].every((item) => typeof item === "string")) {
    const removed = new Set(base.filter((item) => !local.includes(item)));
    const added = local.filter((item) => !base.includes(item) && !latest.includes(item));
    return latest.filter((item) => !removed.has(item)).concat(added);
  }

  const allItems = [...base, ...local, ...latest];
  if (allItems.every((item) => storeItemIdentity(item) !== null)) {
    const identity = storeItemIdentity;
    const baseById = new Map(base.map((item) => [identity(item), item]));
    const localById = new Map(local.map((item) => [identity(item), item]));
    let merged = latest.filter((item) => !(baseById.has(identity(item)) && !localById.has(identity(item))));

    for (const item of local) {
      const key = identity(item);
      const previous = baseById.get(key);
      if (previous !== undefined && sameJson(previous, item)) continue;
      const index = merged.findIndex((candidate) => identity(candidate) === key);
      if (index >= 0) merged[index] = item;
      else merged.push(item);
    }
    return merged;
  }

  return local;
}

function mergeStoreChanges(base = {}, local = {}, latest = {}) {
  const merged = { ...latest };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(latest)])) {
    const previous = base[key];
    const desired = local[key];
    const current = latest[key];
    if (sameJson(previous, desired)) {
      if (current === undefined) delete merged[key];
      else merged[key] = current;
    } else if (Array.isArray(previous) && Array.isArray(desired) && Array.isArray(current)) {
      merged[key] = mergeStoreArray(previous, desired, current);
    } else if (desired === undefined) {
      delete merged[key];
    } else {
      merged[key] = desired;
    }
  }
  return normalizeStore(merged);
}

function safeErrorMetadata(error) {
  const details = {
    name: /^[A-Za-z][A-Za-z0-9_.-]{0,49}$/.test(String(error?.name || ""))
      ? String(error.name)
      : "Error"
  };
  const status = Number(error?.status ?? error?.statusCode);
  if (Number.isInteger(status) && status >= 100 && status <= 599) details.status = status;
  const code = typeof error?.code === "string" ? error.code : "";
  if (/^[A-Z0-9_.-]{1,50}$/.test(code)) details.code = code;
  return details;
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
    disabledIntegrations: Array.isArray(parsed.disabledIntegrations)
      ? [...new Set(parsed.disabledIntegrations.filter((item) => INTEGRATION_PROVIDER_IDS.includes(item)))]
      : [],
    oauthConnections: Array.isArray(parsed.oauthConnections)
      ? parsed.oauthConnections.slice(0, 4).flatMap((item) => {
          try { return [normalizeGoogleOAuthConnection(item)]; } catch { return []; }
        })
      : [],
    externalActions: Array.isArray(parsed.externalActions)
      ? parsed.externalActions.slice(-MAX_ACTION_HISTORY).flatMap((item) => {
          const normalized = normalizeExternalAction(item);
          return normalized ? [normalized] : [];
        })
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

function setGoogleOAuthCookie(res, value) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", "jarvis_google_oauth=" + encodeURIComponent(value) +
    "; HttpOnly; SameSite=Lax; Path=/api/integrations/google_drive/oauth/callback; Max-Age=600" + secure);
}

function clearGoogleOAuthCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", "jarvis_google_oauth=; HttpOnly; SameSite=Lax; Path=/api/integrations/google_drive/oauth/callback; Max-Age=0" + secure);
}

async function requireAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie).jarvis_session;
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    const valid = await runtimeStore.refreshSession(token, SESSION_TTL_MS);
    if (!valid) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Please sign in to continue." });
    }
    req.sessionToken = token;
    return next();
  } catch (error) {
    console.error("Session validation failed:", error?.name || "Error");
    return res.status(503).json({ error: "Authentication is temporarily unavailable. Please try again." });
  }
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
    await runtimeStore.ensureTables();
    await sql`CREATE TABLE IF NOT EXISTS jarvis_app_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      state JSONB NOT NULL,
      revision BIGINT NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE jarvis_app_state
      ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1`;
    const rows = await sql`SELECT state, revision FROM jarvis_app_state WHERE id = 1 LIMIT 1`;
    if (rows.length > 0) {
      const saved = typeof rows[0].state === "string" ? JSON.parse(rows[0].state) : rows[0].state;
      store = normalizeStore(saved);
      databaseBaseStore = cloneStore(store);
      databaseRevision = Number(rows[0].revision) || 1;
      // Remove legacy durable chat transcripts without overwriting concurrent updates.
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
    const inserted = await sql`INSERT INTO jarvis_app_state (id, state, revision, updated_at)
      VALUES (1, ${snapshot}::jsonb, 1, now())
      ON CONFLICT (id) DO NOTHING RETURNING revision`;
    if (inserted.length > 0) {
      databaseRevision = Number(inserted[0].revision) || 1;
      databaseBaseStore = cloneStore(store);
      return;
    }
    const latestRows = await sql`SELECT state, revision FROM jarvis_app_state WHERE id = 1 LIMIT 1`;
    if (!latestRows.length) throw new Error("JARVIS application state could not be initialized.");
    const latestState = typeof latestRows[0].state === "string" ? JSON.parse(latestRows[0].state) : latestRows[0].state;
    store = normalizeStore(latestState);
    databaseBaseStore = cloneStore(store);
    databaseRevision = Number(latestRows[0].revision) || 1;
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
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const databaseSnapshot = JSON.stringify(store);
        const expectedRevision = Number(databaseRevision) || 1;
        const updated = await sql`UPDATE jarvis_app_state
          SET state = ${databaseSnapshot}::jsonb,
              revision = revision + 1,
              updated_at = now()
          WHERE id = 1 AND revision = ${expectedRevision}
          RETURNING revision`;
        if (updated.length > 0) {
          databaseRevision = Number(updated[0].revision);
          databaseBaseStore = cloneStore(store);
          return;
        }

        const latestRows = await sql`SELECT state, revision FROM jarvis_app_state WHERE id = 1 LIMIT 1`;
        if (!latestRows.length) throw new Error("JARVIS application state is missing from Neon.");
        const latestState = typeof latestRows[0].state === "string" ? JSON.parse(latestRows[0].state) : latestRows[0].state;
        const latest = normalizeStore(latestState);
        store = mergeStoreChanges(databaseBaseStore || {}, store, latest);
        databaseBaseStore = cloneStore(latest);
        databaseRevision = Number(latestRows[0].revision) || 1;
      }
      throw new Error("JARVIS data kept changing during the save. Please retry the action.");
    }
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tempFile = STORE_FILE + ".tmp";
    await fs.writeFile(tempFile, snapshot, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tempFile, STORE_FILE);
  });
  return writeQueue;
}

async function getConversationMessages(key) {
  return runtimeStore.getConversationMessages(key);
}

async function appendConversationTurn(key, message, result) {
  return runtimeStore.appendConversationTurn(key, message, result);
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
  const history = (await getConversationMessages(conversationKey))
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-10)
    .map(({ role, content }) => ({ role, content }));

  const memoryIntent = parseExplicitMemoryIntent(message);
  const forgetIntent = parseExplicitForgetIntent(message);
  let result;
  if (forgetIntent?.ambiguous) {
    result = {
      answer: "I haven't deleted anything. Send the exact saved note after “Forget:” or “Bhool jao:” so I can identify only that one memory.",
      engine: "memory",
      externalAI: false
    };
  } else if (forgetIntent) {
    const matchedMemory = findExactMemory(store.memories, forgetIntent.content);
    if (!matchedMemory) {
      result = {
        answer: "I couldn't find an exact match, so nothing was deleted. Open Memory to review your saved notes, then copy the exact note after “Forget:”.",
        engine: "memory",
        externalAI: false
      };
    } else {
      store.memories = store.memories.filter((item) => item.id !== matchedMemory.id);
      await saveStore();
      result = {
        answer: "Deleted that exact saved memory. Other memories and your temporary chat history were left unchanged.",
        engine: "memory",
        externalAI: false
      };
    }
  } else if (memoryIntent?.blocked) {
    result = {
      answer: "I won't save that because it may contain a secret or sensitive personal information. Use the secure service directly instead.",
      engine: "privacy-guard",
      externalAI: false
    };
  } else if (memoryIntent) {
    const candidate = normalizeMemory({ content: memoryIntent.content, category: memoryIntent.category });
    const existing = store.memories.find((item) => isDuplicateMemory([item], candidate));
    if (existing) {
      result = { answer: existing.enabled === false ? "That note is already saved, but paused from chat context. You can resume it in Memory." : "That preference or fact is already in your saved memory.", engine: "memory", externalAI: false };
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

  const enrichedResult = { ...result, nlu: classifyIntent(message) };
  await appendConversationTurn(conversationKey, message, enrichedResult);
  return enrichedResult;
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
        const research = await createWebResearch(message);
        return { ...research, externalAI: Boolean(research.aiSynthesized) };
      } catch (error) {
        if (error?.code === "RESTRICTED_RESEARCH_QUERY") {
          return { answer: error.message, engine: "safety-filter", externalAI: false };
        }
        console.error("Automatic live web research failed:", safeErrorMetadata(error));
        webNotice = "I could not verify this with live web sources right now. The answer below is not live-verified.";
      }
    } else {
      webNotice = "Live web search is currently disabled on the server, so this answer is not checked against current internet sources.";
    }
  }

  // Resolve deterministic requests before spending a model call. Live web research above
  // remains first for prompts that need current information.
  const offlineTurn = resolveOfflineAssistantTurn({
    message,
    memories: store.memories,
    tasks: store.tasks,
    skills: getActiveSkillContext(store.skills, message, 3),
    feedback: store.feedback,
    knowledge: buildKnowledgeContext(store.knowledge, message, 3)
  });
  if (offlineTurn) {
    return {
      ...offlineTurn,
      answer: webNotice ? webNotice + "\n\n" + offlineTurn.answer : offlineTurn.answer
    };
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
        engine: "online-conversation",
        externalAI: true,
        liveWebChecked: false
      };
    } catch (error) {
      console.error("Online AI request failed; using the offline brain:", safeErrorMetadata(error));
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
  const aiRuntime = getAIProviderStatus();
  const searchRuntime = getWebResearchStatus();
  const pageReaderRuntime = getWebPageReadStatus();
  const conversationAIEnabled = aiRuntime.conversationEnabled;
  const plannerAIEnabled = aiRuntime.plannerEnabled;
  const webResearchEnabled = searchRuntime.enabled;
  res.json({
    ok: true,
    service: "jarvis",
    version: "1.12.0-system-readiness",
    brain: conversationAIEnabled ? "offline-first-with-online-conversation-fallback" : "built-in-offline-rules",
    intelligence: getIntelligenceStatus(aiRuntime),
    plannerAIEnabled,
    conversationAIEnabled,
    webResearchEnabled,
    externalAI: plannerAIEnabled || conversationAIEnabled,
    aiProvider: {
      provider: aiRuntime.provider,
      configured: aiRuntime.configured,
      baseUrlConfigured: aiRuntime.baseUrlConfigured,
      model: aiRuntime.model,
      modelValid: aiRuntime.modelValid,
      requestTimeoutMs: aiRuntime.requestTimeoutMs,
      retryAttempts: aiRuntime.retryAttempts
    },
    searchProvider: {
      provider: searchRuntime.provider,
      configured: searchRuntime.configured,
      enabled: searchRuntime.enabled,
      maxResults: searchRuntime.maxResults,
      timeoutMs: searchRuntime.timeoutMs,
      retryAttempts: searchRuntime.retryAttempts
    },
    pageReader: {
      enabled: pageReaderRuntime.enabled,
      timeoutMs: pageReaderRuntime.timeoutMs,
      maxBytes: pageReaderRuntime.maxBytes,
      maxChars: pageReaderRuntime.maxChars,
      allowedContentTypes: pageReaderRuntime.allowedContentTypes
    },
    sourceAnswer: {
      enabled: pageReaderRuntime.enabled && searchRuntime.enabled,
      minimumSources: SOURCE_ANSWER_LIMITS.minimumSources,
      maximumSources: SOURCE_ANSWER_LIMITS.maximumSources,
      requiresSessionBoundPageTokens: true,
      requiresLiveSearch: true
    },
    knowledgePolicy: {
      persistent: true,
      storage: process.env.DATABASE_URL ? "neon-app-state" : "local-json-file",
      webResearchRequiresUserReview: true,
      unreviewedResearchInAssistantContext: false,
      rejectedResearchInAssistantContext: false,
      automaticSaving: false,
      maxItems: KNOWLEDGE_LIMITS.items
    },
    memoryPolicy: {
      explicitSavingOnly: true,
      pausedMemoriesInAssistantContext: false,
      contextPreviewAvailable: true,
      maxContextItems: MEMORY_LIMITS.contextItems,
      maxContextChars: MEMORY_LIMITS.contextChars,
      forgetRequiresExactSavedNote: true,
      ambiguousForgetDeletesNothing: true,
      temporaryChatHistoryMessages: 10
    },
    runtimeStorage: runtimeStore.mode()
  });
});

app.get("/api/diagnostics", requireAuth, diagnosticsLimiter, async (_req, res) => {
  const checks = [];
  const warnings = [];
  const addCheck = (id, label, status, summary, details = {}) => {
    checks.push({ id, label, status, summary, details });
    if (status === "warning") warnings.push(summary);
  };

  let primaryStorage;
  try {
    if (process.env.DATABASE_URL) {
      const sql = getNeonSql();
      const rows = await sql`SELECT revision FROM jarvis_app_state WHERE id = 1 LIMIT 1`;
      if (!rows.length) throw new Error("Persistent application state is missing.");
      primaryStorage = {
        mode: "neon-postgresql",
        status: "ready",
        summary: "Neon PostgreSQL is reachable and the JARVIS application-state record is available.",
        revision: Number(rows[0].revision) || 1
      };
    } else {
      await fs.access(STORE_FILE);
      primaryStorage = {
        mode: "local-json-file",
        status: "warning",
        summary: "JARVIS is using its local JSON state file. Confirm that the hosting platform provides persistent storage."
      };
    }
  } catch {
    primaryStorage = {
      mode: process.env.DATABASE_URL ? "neon-postgresql" : "local-json-file",
      status: "error",
      summary: "The primary JARVIS state store could not be verified. Avoid relying on new writes until storage is checked."
    };
  }

  const ai = getAIProviderStatus();
  const search = getWebResearchStatus();
  const pageReader = getWebPageReadStatus();
  const googleConnection = store.oauthConnections.find((item) => item?.provider === "google_drive") || null;
  const googleOAuth = getGoogleOAuthStatus(googleConnection, process.env);
  const integrations = getIntegrationCatalog(process.env, store.disabledIntegrations, store.oauthConnections);

  addCheck("service", "JARVIS service", "ready", "The authenticated diagnostics endpoint is responding.");
  addCheck(
    "primary-storage",
    "Primary data storage",
    primaryStorage.status,
    primaryStorage.summary,
    { mode: primaryStorage.mode }
  );
  addCheck(
    "temporary-chat-storage",
    "Temporary chat storage",
    process.env.DATABASE_URL ? "ready" : "warning",
    process.env.DATABASE_URL
      ? "Temporary chat history uses the shared Neon runtime tables."
      : "Temporary chat history uses process memory and is cleared when the server process restarts.",
    { mode: runtimeStore.mode(), messageLimit: 32, inactivityTtlMinutes: 60 }
  );
  addCheck(
    "ai-conversation",
    "AI conversation provider",
    ai.conversationEnabled ? "ready" : "warning",
    ai.conversationEnabled
      ? "The server AI provider is configured and enabled for conversation."
      : ai.configured
        ? "The AI provider is configured, but conversation is not enabled."
        : "No server AI provider is configured. JARVIS will use its built-in offline brain where supported.",
    { configured: ai.configured, enabled: ai.enabled, conversationEnabled: ai.conversationEnabled, provider: ai.provider, modelConfigured: ai.modelValid }
  );
  addCheck(
    "ai-device-planner",
    "AI device planner",
    ai.plannerEnabled ? "ready" : "warning",
    ai.plannerEnabled
      ? "The optional server AI planner is enabled."
      : "The remote AI planner is unavailable; supported built-in device commands remain available.",
    { configured: ai.configured, plannerEnabled: ai.plannerEnabled }
  );
  addCheck(
    "live-web-search",
    "Live web search",
    search.enabled ? "ready" : "warning",
    search.enabled
      ? "The configured SearXNG search provider is enabled."
      : "Live web search is not enabled. Current information may not be verified against the internet.",
    { configured: search.configured, enabled: search.enabled, provider: search.provider }
  );
  addCheck(
    "full-page-reading",
    "Full-page reading",
    pageReader.enabled ? "ready" : "warning",
    pageReader.enabled
      ? "The secure HTTPS full-page reader is enabled."
      : "Full-page reading is disabled in the server configuration.",
    { enabled: pageReader.enabled }
  );
  addCheck(
    "source-based-answers",
    "Source-based answers",
    pageReader.enabled && search.enabled ? "ready" : "warning",
    pageReader.enabled && search.enabled
      ? "Live search and secure page reading are both enabled."
      : "Source-based answers need both live web search and full-page reading enabled.",
    { enabled: pageReader.enabled && search.enabled, minimumSources: SOURCE_ANSWER_LIMITS.minimumSources, maximumSources: SOURCE_ANSWER_LIMITS.maximumSources }
  );
  addCheck(
    "google-drive",
    "Google Drive OAuth",
    googleOAuth.connected ? "ready" : "warning",
    googleOAuth.connected
      ? "Google Drive has a valid encrypted refresh-token record."
      : googleOAuth.canConnect
        ? "Google OAuth and the encrypted token vault are configured; Drive is not connected yet."
        : "Google Drive connection setup is incomplete. Review the server OAuth and encryption-key configuration.",
    { canConnect: googleOAuth.canConnect, connected: googleOAuth.connected, canCreateDocs: googleOAuth.canCreateDocs, grantedScopes: googleOAuth.grantedScopes }
  );

  const configuredIntegrations = integrations.filter((item) => item.configured).length;
  const enabledIntegrations = integrations.filter((item) => item.enabled).length;
  addCheck(
    "external-integrations",
    "External integrations",
    configuredIntegrations > 0 ? "ready" : "warning",
    configuredIntegrations > 0
      ? configuredIntegrations + " of " + integrations.length + " integration providers are configured; " + enabledIntegrations + " are enabled. Configuration does not mean a live connection test has passed."
      : "No external integration credentials or OAuth connection are configured.",
    { providers: integrations.map((item) => ({ id: item.id, name: item.name, configured: item.configured, enabled: item.enabled, disabled: item.disabled })) }
  );

  const activeDevices = store.devices.filter((item) => !item.revokedAt);
  const accessibilityDevices = activeDevices.filter((item) => item.accessibilityEnabled);
  addCheck(
    "android-companion",
    "Android Companion",
    activeDevices.length > 0 ? "ready" : "warning",
    activeDevices.length > 0
      ? activeDevices.length + " active paired device(s); " + accessibilityDevices.length + " report Accessibility enabled."
      : "No active Android Companion is paired with this JARVIS workspace.",
    { pairedDevices: activeDevices.length, accessibilityEnabledDevices: accessibilityDevices.length, deviceLimit: 5 }
  );

  const criticalFailure = primaryStorage.status === "error";
  const overallStatus = criticalFailure ? "degraded" : warnings.length ? "attention" : "ready";
  res.json({
    ok: !criticalFailure,
    status: overallStatus,
    generatedAt: new Date().toISOString(),
    version: "1.12.0-system-readiness",
    summary: criticalFailure
      ? "JARVIS is responding, but primary data storage needs attention."
      : warnings.length
        ? "JARVIS core storage is available. Some optional services or connections are not enabled."
        : "JARVIS core storage and configured capabilities are ready.",
    warningCount: warnings.length,
    errorCount: criticalFailure ? 1 : 0,
    checks,
    inventory: {
      tasks: store.tasks.length,
      memories: store.memories.length,
      knowledgeItems: store.knowledge.length,
      savedResearchItems: store.research.length,
      workflows: store.workflows.length,
      pairedDevices: activeDevices.length
    }
  });
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const candidate = cleanText(req.body?.password, 500);
  if (!PASSWORD || !candidate || !passwordsMatch(candidate, PASSWORD)) {
    return res.status(401).json({ error: "Incorrect password or server password is not configured." });
  }
  const token = crypto.randomBytes(32).toString("base64url");
  try {
    await runtimeStore.createSession(token, SESSION_TTL_MS);
  } catch (error) {
    console.error("Session creation failed:", error?.name || "Error");
    return res.status(503).json({ error: "Authentication is temporarily unavailable. Please try again." });
  }
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post("/api/logout", requireAuth, async (req, res) => {
  clearSessionCookie(res);
  try {
    await runtimeStore.deleteSession(req.sessionToken);
    res.json({ ok: true });
  } catch (error) {
    console.error("Session cleanup failed:", error?.name || "Error");
    res.status(503).json({ error: "The session was signed out locally, but server cleanup could not be confirmed." });
  }
});

app.get("/api/session", requireAuth, (_req, res) => {
  res.json({ authenticated: true });
});

app.get("/api/state", requireAuth, async (req, res, next) => {
  try {
    res.json({
    chats: await getConversationMessages("session:" + req.sessionToken),
    memories: store.memories,
    tasks: store.tasks.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    feedback: store.feedback.slice(-100),
    experiencePreferences: store.experiencePreferences,
    skills: store.skills,
    workflows: store.workflows,
    workflowRuns: store.workflowRuns.slice().reverse().slice(0, 50),
    research: store.research.slice().reverse()
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/chat/history", requireAuth, async (req, res, next) => {
  try {
    await runtimeStore.deleteConversationMessages("session:" + req.sessionToken);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
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
      workflowRuns: store.workflowRuns,
      disabledIntegrations: store.disabledIntegrations,
      externalActions: store.externalActions
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
    console.error("Assistant reply failed:", safeErrorMetadata(error));
    res.status(500).json({ error: "JARVIS could not process this request. Please try again." });
  }
});

app.get("/api/memories", requireAuth, (req, res) => {
  const query = cleanText(req.query.q, 300);
  const category = cleanText(req.query.category, 30);
  const requestedLimit = Number.parseInt(String(req.query.limit || String(MEMORY_LIMITS.items)), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(MEMORY_LIMITS.items, Math.max(1, requestedLimit)) : MEMORY_LIMITS.items;
  const items = searchMemories(store.memories, query, category, limit);
  res.setHeader("Cache-Control", "no-store");
  res.json({ query, category, total: store.memories.length, count: items.length, items });
});

app.post("/api/memories/preview", requireAuth, (req, res) => {
  const query = cleanText(req.body?.query, 4000);
  if (!query) return res.status(400).json({ error: "Enter a prompt to preview memory context." });
  const preview = previewMemoryContext(store.memories, query, MEMORY_LIMITS.contextItems);
  res.setHeader("Cache-Control", "no-store");
  res.json(preview);
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
      enabled: typeof req.body?.enabled === "boolean" ? req.body.enabled : existing.enabled !== false,
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

function getGoogleDriveOAuthConnection() {
  return store.oauthConnections.find((item) => item.provider === "google_drive") || null;
}

function integrationCatalogResponse() {
  const googleConnection = getGoogleDriveOAuthConnection();
  const googleDriveOAuth = getGoogleOAuthStatus(googleConnection, process.env);
  const providers = getIntegrationCatalog(process.env, store.disabledIntegrations, store.oauthConnections);
  const googleProvider = providers.find((item) => item.id === "google_drive");
  if (googleProvider) {
    googleProvider.oauthConnected = googleDriveOAuth.connected;
    googleProvider.oauthReady = googleDriveOAuth.canConnect;
    googleProvider.configured = googleProvider.environmentConfigured || googleDriveOAuth.connected || googleDriveOAuth.canConnect;
    googleProvider.enabled = googleProvider.configured && !googleProvider.disabled;
  }
  return {
    providers,
    googleDriveOAuth,
    permissions: getIntegrationPermissionCatalog(googleConnection, process.env),
    credentialStorage: "server-environment-or-encrypted-vault",
    supportedOperations: "read-only"
  };
}

async function getGoogleDriveTokenForIntegration() {
  const connection = getGoogleDriveOAuthConnection();
  if (!connection) return "";
  return getGoogleDriveAccessToken(connection, {
    onRefresh: async (updatedConnection) => {
      store.oauthConnections = store.oauthConnections.map((item) =>
        item.provider === "google_drive" ? updatedConnection : item
      );
      await saveStore();
    }
  });
}

function googleDriveIntegrationOptions() {
  return getGoogleDriveOAuthConnection()
    ? { getGoogleDriveAccessToken: getGoogleDriveTokenForIntegration }
    : {};
}

function getActionCapabilities() {
  return getExternalActionCapabilities({
    env: process.env,
    googleDriveOAuth: getGoogleOAuthStatus(getGoogleDriveOAuthConnection(), process.env),
    disabledProviders: store.disabledIntegrations
  });
}

function replaceExternalAction(action) {
  store.externalActions = store.externalActions.map((item) => item.id === action.id ? action : item);
}

app.get("/api/actions/capabilities", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(getActionCapabilities());
});

app.get("/api/actions", requireAuth, async (_req, res) => {
  let changed = false;
  const now = Date.now();
  store.externalActions = store.externalActions.map((action) => {
    if (action.status === "pending" && Date.parse(action.expiresAt) <= now) {
      changed = true;
      return appendActionStatus(action, "expired", "Preview expired before confirmation. Nothing was sent or created.");
    }
    return action;
  });
  if (changed) await saveStore();
  res.setHeader("Cache-Control", "no-store");
  res.json({ actions: store.externalActions.slice().reverse().slice(0, MAX_ACTION_HISTORY) });
});

app.post("/api/actions", requireAuth, actionPreviewLimiter, async (req, res) => {
  const pendingCount = store.externalActions.filter((action) =>
    action.status === "pending" && Date.parse(action.expiresAt) > Date.now()
  ).length;
  if (pendingCount >= MAX_PENDING_ACTIONS) {
    return res.status(409).json({ error: "There are already 20 unconfirmed previews. Cancel or review one before creating another." });
  }
  let action;
  try {
    action = createPendingExternalAction(req.body, { capabilities: getActionCapabilities(), env: process.env });
  } catch (error) {
    return res.status(error instanceof TypeError ? 400 : 409).json({ error: error.message || "Action preview could not be created." });
  }
  store.externalActions.push(action);
  store.externalActions = store.externalActions.slice(-MAX_ACTION_HISTORY);
  await saveStore();
  res.status(201).json({ action });
});

app.post("/api/actions/:id/execute", requireAuth, actionConfirmLimiter, async (req, res) => {
  const action = store.externalActions.find((item) => item.id === req.params.id);
  if (!action) return res.status(404).json({ error: "Action preview not found." });
  if (action.status !== "pending") return res.status(409).json({ error: "This preview is no longer pending. It cannot be executed again." });
  if (Date.parse(action.expiresAt) <= Date.now()) {
    const expired = appendActionStatus(action, "expired", "Preview expired before confirmation. Nothing was sent or created.");
    replaceExternalAction(expired);
    await saveStore();
    return res.status(410).json({ error: "This preview expired. Create a new preview after reviewing the details." });
  }
  const confirmation = cleanText(req.body?.confirmation, 40);
  if (confirmation !== action.confirmationPhrase) {
    return res.status(400).json({ error: "Confirmation text does not match. No external action was performed." });
  }

  const capabilities = getActionCapabilities();
  if (action.provider === "telegram" && !capabilities.telegram.enabled) {
    return res.status(409).json({ error: "Telegram is disabled or no longer configured. Nothing was sent." });
  }
  if (action.provider === "telegram" && !capabilities.telegram.allowedChatIds.includes(action.chatId)) {
    return res.status(409).json({ error: "The Telegram destination is no longer allow-listed. Nothing was sent." });
  }
  if (action.provider === "google_drive" && !capabilities.googleDrive.canCreateDocs) {
    return res.status(409).json({ error: "Google Docs creation permission is not active. Nothing was created." });
  }

  const executing = appendActionStatus(action, "executing", "Exact confirmation received. The selected provider is processing this one action.");
  replaceExternalAction(executing);
  await saveStore();

  try {
    const result = await executeExternalAction(executing, {
      env: process.env,
      getGoogleDriveAccessToken: getGoogleDriveTokenForIntegration
    });
    const completed = appendActionStatus(executing, "completed", result.summary, result);
    replaceExternalAction(completed);
    await saveStore();
    return res.json({ action: completed });
  } catch (error) {
    const failed = appendActionStatus(
      executing,
      "failed",
      error?.message || "Provider did not confirm the action. Check the provider before trying again.",
      error?.partialResult || null
    );
    replaceExternalAction(failed);
    await saveStore();
    return res.status(502).json({ error: error?.message || "The provider did not confirm the action. Check the provider before trying again.", action: failed });
  }
});

app.post("/api/actions/:id/cancel", requireAuth, async (req, res) => {
  const action = store.externalActions.find((item) => item.id === req.params.id);
  if (!action) return res.status(404).json({ error: "Action preview not found." });
  if (action.status !== "pending") return res.status(409).json({ error: "Only a pending preview can be cancelled." });
  const cancelled = appendActionStatus(action, "cancelled", "Cancelled by the user. No external action was performed.");
  replaceExternalAction(cancelled);
  await saveStore();
  res.json({ action: cancelled });
});

app.get("/api/integrations", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(integrationCatalogResponse());
});

app.post("/api/integrations/google_drive/oauth/start", requireAuth, oauthStartLimiter, async (req, res) => {
  if (store.disabledIntegrations.includes("google_drive")) {
    return res.status(409).json({ error: "Enable Google Drive in JARVIS before starting OAuth." });
  }
  try {
    const capability = req.body?.capability === "create_docs" ? "create_docs" : "read";
    const result = await beginGoogleOAuth({ sessionToken: req.sessionToken, capability, runtimeStore });
    const launchUrl = createGoogleOAuthBrowserHandoff(result);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.json({ launchUrl });
  } catch (error) {
    res.status(503).json({ error: error.message || "Google OAuth could not start." });
  }
});

app.get("/api/integrations/google_drive/oauth/launch", oauthLaunchLimiter, (req, res) => {
  const handoff = consumeGoogleOAuthBrowserHandoff(req.query?.ticket);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (!handoff) {
    return res.status(410).type("text/plain").send("This Google sign-in link has expired or was already used. Return to JARVIS and start again.");
  }
  setGoogleOAuthCookie(res, handoff.browserBinding);
  return res.redirect(303, handoff.authorizationUrl);
});

app.get("/api/integrations/google_drive/oauth/callback", oauthCallbackLimiter, async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const browserBinding = cookies.jarvis_google_oauth || "";
  const state = cleanText(req.query?.state, 200);
  const code = cleanText(req.query?.code, 4000);
  const oauthError = cleanText(req.query?.error, 100);
  const existingConnection = getGoogleDriveOAuthConnection();
  try {
    const connection = await finishGoogleOAuth({
      state,
      code,
      oauthError,
      browserBinding,
      existingConnection,
      runtimeStore,
      isSessionValid: (sessionHash) => runtimeStore.refreshSessionByHash(sessionHash, SESSION_TTL_MS)
    });
    store.oauthConnections = store.oauthConnections.filter((item) => item.provider !== "google_drive");
    store.oauthConnections.push(connection);
    await saveStore();
    clearGoogleOAuthCookie(res);
    res.setHeader("Cache-Control", "no-store");
    const docsEnabled = connection.grantedScopes.includes("https://www.googleapis.com/auth/drive.file");
    return res.redirect(303, "/?integration=google_drive_connected" + (docsEnabled ? "&capability=create_docs" : ""));
  } catch (error) {
    clearGoogleOAuthCookie(res);
    console.warn("Google Drive OAuth callback was not completed:", error?.message || "OAuth error");
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(303, "/?integration=google_drive_error");
  }
});

app.post("/api/integrations/google_drive/oauth/revoke", requireAuth, integrationTestLimiter, async (_req, res) => {
  const connection = getGoogleDriveOAuthConnection();
  if (!connection) return res.status(404).json({ error: "No Google Drive OAuth connection is stored in JARVIS." });
  try {
    await revokeGoogleOAuthConnection(connection);
    store.oauthConnections = store.oauthConnections.filter((item) => item.provider !== "google_drive");
    clearGoogleDriveTokenCache();
    await saveStore();
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, message: "Google Drive OAuth permission was revoked and its encrypted token was removed from JARVIS.", ...integrationCatalogResponse() });
  } catch (error) {
    res.status(502).json({ error: error.message || "Google Drive access could not be revoked." });
  }
});

app.post("/api/integrations/:provider/test", requireAuth, integrationTestLimiter, async (req, res) => {
  const provider = req.params.provider;
  if (!INTEGRATION_PROVIDER_IDS.includes(provider)) return res.status(404).json({ error: "Integration provider not found." });
  if (store.disabledIntegrations.includes(provider)) return res.status(409).json({ error: "This connection is disabled in JARVIS. Enable it before testing." });
  try {
    const result = await probeIntegration(provider, provider === "google_drive" ? googleDriveIntegrationOptions() : {});
    res.json(result);
  } catch (error) {
    const status = error instanceof TypeError ? 400 : 502;
    res.status(status).json({ error: error.message || "Integration test failed." });
  }
});

app.post("/api/integrations/:provider/disable", requireAuth, async (req, res) => {
  const provider = req.params.provider;
  if (!INTEGRATION_PROVIDER_IDS.includes(provider)) return res.status(404).json({ error: "Integration provider not found." });
  if (!store.disabledIntegrations.includes(provider)) {
    store.disabledIntegrations.push(provider);
    await saveStore();
  }
  res.json({ ok: true, ...integrationCatalogResponse() });
});

app.post("/api/integrations/:provider/enable", requireAuth, async (req, res) => {
  const provider = req.params.provider;
  if (!INTEGRATION_PROVIDER_IDS.includes(provider)) return res.status(404).json({ error: "Integration provider not found." });
  store.disabledIntegrations = store.disabledIntegrations.filter((item) => item !== provider);
  await saveStore();
  res.json({ ok: true, ...integrationCatalogResponse() });
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

async function runEnabledIntegration(provider, action) {
  if (store.disabledIntegrations.includes(provider)) {
    throw new Error(provider.replaceAll("_", " ") + " connection is disabled in JARVIS.");
  }
  return runIntegrationAction(action, provider === "google_drive" ? googleDriveIntegrationOptions() : {});
}

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
    }),
    github_list_repositories: async () => runEnabledIntegration("github", "github_list_repositories"),
    google_drive_list_files: async () => runEnabledIntegration("google_drive", "google_drive_list_files"),
    telegram_get_bot_profile: async () => runEnabledIntegration("telegram", "telegram_get_bot_profile"),
    elevenlabs_get_account: async () => runEnabledIntegration("elevenlabs", "elevenlabs_get_account")
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
  const review = cleanText(req.query.review, 20) || "all";
  const allowedReviews = new Set(["all", "trusted", "unreviewed", "rejected"]);
  if (!allowedReviews.has(review)) return res.status(400).json({ error: "Choose a valid knowledge review filter." });

  const requestedLimit = Number.parseInt(String(req.query.limit || "100"), 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 100;
  const counts = store.knowledge.reduce((summary, item) => {
    summary.total += 1;
    if (item.reviewStatus === "user-authored" || item.reviewStatus === "user-reviewed") summary.trusted += 1;
    if (item.reviewStatus === "unreviewed") summary.unreviewed += 1;
    if (item.reviewStatus === "rejected") summary.rejected += 1;
    return summary;
  }, { total: 0, trusted: 0, unreviewed: 0, rejected: 0 });

  const filtered = review === "trusted"
    ? store.knowledge.filter((item) => item.reviewStatus === "user-authored" || item.reviewStatus === "user-reviewed")
    : review === "unreviewed"
      ? store.knowledge.filter((item) => item.reviewStatus === "unreviewed")
      : review === "rejected"
        ? store.knowledge.filter((item) => item.reviewStatus === "rejected")
        : store.knowledge;

  const items = searchKnowledgeItems(filtered, query, limit);
  res.json({ query, review, total: counts.total, count: items.length, reviewSummary: counts, items });
});

app.post("/api/knowledge", requireAuth, async (req, res) => {
  let item;
  try {
    item = normalizeKnowledgeItem(req.body);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Knowledge entry is invalid." });
  }

  const duplicateIndex = store.knowledge.findIndex((existing) => isDuplicateKnowledge([existing], item));
  if (duplicateIndex >= 0) {
    const duplicate = store.knowledge[duplicateIndex];
    let merged;
    try {
      merged = mergeDuplicateKnowledge(duplicate, item);
    } catch {
      return res.status(409).json({ error: "The duplicate knowledge entry could not be safely merged." });
    }
    const changed = JSON.stringify(merged) !== JSON.stringify(duplicate);
    if (changed) {
      store.knowledge[duplicateIndex] = merged;
      await saveStore();
    }
    return res.status(200).json({ item: merged, duplicate: true, merged: changed });
  }

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
  if (item.sourceKind !== "web-research") {
    return res.status(400).json({ error: "Only saved web research has a review workflow. Your own notes remain user-authored." });
  }

  const requestedStatus = cleanText(req.body?.reviewStatus, 30);
  if (!["user-reviewed", "unreviewed", "rejected"].includes(requestedStatus)) {
    return res.status(400).json({ error: "Choose reviewed, needs review, or rejected." });
  }

  const now = new Date().toISOString();
  const updated = normalizeKnowledgeItem({
    ...item,
    reviewStatus: requestedStatus,
    reviewNote: requestedStatus === "rejected" ? cleanText(req.body?.reviewNote, KNOWLEDGE_LIMITS.reviewNote) : "",
    reviewedAt: requestedStatus === "user-reviewed" ? now : null,
    rejectedAt: requestedStatus === "rejected" ? now : null,
    updatedAt: now
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
      error: "Live web search is disabled. Configure JARVIS_SEARCH_BASE_URL and JARVIS_SEARCH_ENABLED=true on the server."
    });
  }

  try {
    const result = await createWebResearch(query);
    if (getWebPageReadStatus().enabled) {
      result.sources = result.sources.map(source => ({
        ...source,
        readToken: createPageReadToken(source.url, req.sessionToken, PASSWORD)
      }));
    }
    res.json(result);
  } catch (error) {
    if (error?.code === "RESTRICTED_RESEARCH_QUERY") {
      return res.status(400).json({ error: error.message });
    }
    console.error("Web search failed:", safeErrorMetadata(error));
    res.status(502).json({ error: "Live web research could not complete this request. Please try again later." });
  }
});

app.post("/api/research/read", requireAuth, pageReadLimiter, async (req, res) => {
  if (!getWebPageReadStatus().enabled) {
    return res.status(503).json({ error: "Full-page reading is disabled. Set JARVIS_PAGE_READ_ENABLED=true on the server." });
  }
  const pageUrl = verifyPageReadToken(req.body?.readToken, req.sessionToken, PASSWORD);
  if (!pageUrl) {
    return res.status(403).json({ error: "Choose a source from a recent JARVIS live search result. Search again to refresh page access." });
  }

  try {
    const result = await createWebPageRead(pageUrl, { question: cleanText(req.body?.question, 800) });
    res.json(result);
  } catch (error) {
    const code = error?.code || "PAGE_READ_FAILED";
    const clientErrors = [
      "PAGE_URL_BLOCKED", "PAGE_ADDRESS_BLOCKED", "PAGE_REDIRECT_BLOCKED",
      "PAGE_CONTENT_TYPE_BLOCKED", "PAGE_ENCODING_BLOCKED", "PAGE_TEXT_EMPTY"
    ];
    const status = code === "PAGE_RESPONSE_TOO_LARGE" ? 413
      : code === "PAGE_TIMEOUT" ? 504
      : clientErrors.includes(code) ? 400 : 502;
    console.error("Full-page read failed:", code);
    res.status(status).json({ error: error?.message || "The source webpage could not be read safely." });
  }
});

app.post("/api/research/answer", requireAuth, sourceAnswerLimiter, async (req, res) => {
  if (!getWebPageReadStatus().enabled) {
    return res.status(503).json({ error: "Full-page reading is disabled. Configure Phase 15 page-reading settings on the server." });
  }
  const question = cleanText(req.body?.question, 800);
  const readTokens = Array.isArray(req.body?.readTokens) ? req.body.readTokens.slice(0, 6) : [];
  if (!question) return res.status(400).json({ error: "Enter a research question first." });
  if (isRestrictedResearchQuery(question)) {
    return res.status(400).json({ error: "I can't provide source-based research for this restricted request." });
  }
  try {
    const result = await createSourceBasedAnswer(readTokens, {
      question,
      sessionToken: req.sessionToken,
      secret: PASSWORD
    });
    res.json(result);
  } catch (error) {
    const code = error?.code || "SOURCE_ANSWER_FAILED";
    const status = code === "SOURCE_ANSWER_INSUFFICIENT_PAGES" ? 422
      : code.startsWith("SOURCE_ANSWER_") ? 400 : 502;
    console.error("Source-based answer failed:", code);
    res.status(status).json({ error: error?.message || "JARVIS could not build a source-based answer." });
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
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

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
