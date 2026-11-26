import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { normalizeApplicationId } from "../services/skill-engine.js";

const PAIRING_CODE_TTL_MS = 3 * 60 * 1000;
const pairingChallenges = new Map();
const dashboardTasks = new Map();
const DEVICE_TASK_STATES = new Set(["queued", "review", "running", "paused", "completed", "failed", "cancelled", "waiting_user", "expired"]);
const DEVICE_TASK_CATEGORIES = new Set(["editing", "navigation", "screen_read", "general"]);

function publicTaskStatus(value) {
  if (!value || typeof value !== "object" || !DEVICE_TASK_STATES.has(value.status)) return null;
  return {
    status: value.status,
    step: Number.isInteger(value.step) ? Math.min(6, Math.max(0, value.step)) : 0,
    total: Number.isInteger(value.total) ? Math.min(6, Math.max(1, value.total)) : 1,
    category: DEVICE_TASK_CATEGORIES.has(value.category) ? value.category : "general",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null
  };
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function clearDashboardTaskTimer(task) {
  if (task?.expiryTimer) clearTimeout(task.expiryTimer);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function hashMatches(storedHex, candidate) {
  if (typeof storedHex !== "string" || !/^[a-f0-9]{64}$/i.test(storedHex)) return false;
  const expected = Buffer.from(storedHex, "hex");
  const actual = sha256(candidate);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name,
    manufacturer: device.manufacturer,
    model: device.model,
    androidVersion: device.androidVersion,
    appVersion: device.appVersion,
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt,
    accessibilityEnabled: Boolean(device.accessibilityEnabled),
    lastTask: publicTaskStatus(device.lastTask),
    backgroundVoiceActive: Boolean(device.backgroundVoiceActive),
    revokedAt: device.revokedAt || null
  };
}

export function createDevicesRouter({ getStore, saveStore, requireAuth, runDeviceVoiceCommand, createAgentPlan }) {
  if (typeof getStore !== "function" || typeof saveStore !== "function" ||
      typeof requireAuth !== "function" || typeof runDeviceVoiceCommand !== "function") {
    throw new TypeError("createDevicesRouter requires store, persistence, dashboard auth and voice handlers.");
  }

  const router = express.Router();
  const pairingAttemptLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 6,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many pairing attempts. Generate a new code later." }
  });

  function requireDeviceAuth(req, res, next) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get("authorization") || "");
    if (!match) return res.status(401).json({ error: "A valid paired-device credential is required." });

    const token = match[1];
    const device = getStore().devices.find((item) => !item.revokedAt && hashMatches(item.tokenHash, token));
    if (!device) return res.status(401).json({ error: "Device credential is invalid or has been revoked." });

    req.jarvisDevice = device;
    next();
  }

  router.post("/pairing-challenges", requireAuth, (req, res) => {
    const now = Date.now();
    for (const [code, challenge] of pairingChallenges) {
      if (challenge.expiresAt <= now || challenge.sessionToken === req.sessionToken) pairingChallenges.delete(code);
    }

    let code;
    do {
      code = String(crypto.randomInt(100000, 1000000));
    } while (pairingChallenges.has(code));

    const expiresAt = now + PAIRING_CODE_TTL_MS;
    pairingChallenges.set(code, { expiresAt, sessionToken: req.sessionToken });
    res.status(201).json({ code, expiresAt: new Date(expiresAt).toISOString(), expiresInSeconds: 180 });
  });

  router.post("/pair", pairingAttemptLimiter, async (req, res) => {
    const code = cleanText(req.body?.code, 6);
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the six-digit pairing code." });

    const challenge = pairingChallenges.get(code);
    if (!challenge || challenge.expiresAt <= Date.now()) {
      pairingChallenges.delete(code);
      return res.status(401).json({ error: "Pairing code is invalid or expired. Generate a new code in JARVIS." });
    }

    const store = getStore();
    const activeDevices = store.devices.filter((item) => !item.revokedAt);
    if (activeDevices.length >= 5) return res.status(409).json({ error: "Device limit reached. Revoke an unused device first." });

    const token = crypto.randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const model = cleanText(req.body?.model, 100);
    const device = {
      id: crypto.randomUUID(),
      name: cleanText(req.body?.name, 100) || model || "Android Companion",
      manufacturer: cleanText(req.body?.manufacturer, 80),
      model,
      androidVersion: cleanText(req.body?.androidVersion, 40),
      appVersion: cleanText(req.body?.appVersion, 40),
      tokenHash: sha256(token).toString("hex"),
      pairedAt: now,
      lastSeenAt: now,
      accessibilityEnabled: false,
      revokedAt: null
    };

    store.devices.push(device);
    store.devices = store.devices.slice(-50);
    pairingChallenges.delete(code);
    await saveStore();

    res.status(201).json({ device: publicDevice(device), deviceToken: token });
  });

  router.get("/", requireAuth, async (req, res) => {
    const now = Date.now();
    let expired = false;
    for (const [deviceId, task] of dashboardTasks) {
      if (task.expiresAt > now) continue;
      dashboardTasks.delete(deviceId);
      clearDashboardTaskTimer(task);
      const device = getStore().devices.find((item) => item.id === deviceId);
      if (device && device.lastTask?.status === "queued") {
        device.lastTask = { status: "expired", step: 0, total: 1, category: "general", updatedAt: new Date().toISOString() };
        expired = true;
      }
    }
    for (const device of getStore().devices) {
      if (device.lastTask?.status !== "queued") continue;
      const queuedAt = Date.parse(device.lastTask.updatedAt || "");
      if (!Number.isFinite(queuedAt) || now - queuedAt < 5 * 60 * 1000) continue;
      device.lastTask = { status: "expired", step: 0, total: 1, category: "general", updatedAt: new Date().toISOString() };
      expired = true;
    }
    if (expired) await saveStore();
    res.json({ devices: getStore().devices.map(publicDevice) });
  });

  router.post("/:deviceId/tasks", requireAuth, (req, res) => {
    const device = getStore().devices.find((item) => item.id === req.params.deviceId && !item.revokedAt);
    if (!device) return res.status(404).json({ error: "Active paired device not found." });
    const message = cleanText(req.body?.message, 3000);
    if (!message) return res.status(400).json({ error: "Enter a task for the paired Android device." });
    const activeTask = ["running", "paused"].includes(device.lastTask?.status);
    const controlCommand = /^(pause task|resume task|cancel task)$/i.test(message);
    if (activeTask && !controlCommand) {
      return res.status(409).json({ error: "This device is busy. Use Pause, Resume or Cancel from the live task monitor." });
    }
    const current = dashboardTasks.get(device.id);
    if (current && current.expiresAt > Date.now()) {
      return res.status(409).json({ error: "This device already has a queued task. Wait for it to start or expire." });
    }
    clearDashboardTaskTimer(current);
    const task = {
      id: crypto.randomUUID(),
      message,
      controlCommand,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 5 * 60 * 1000
    };
    task.expiryTimer = setTimeout(() => {
      if (dashboardTasks.get(device.id) !== task) return;
      dashboardTasks.delete(device.id);
      const currentDevice = getStore().devices.find((item) => item.id === device.id);
      if (currentDevice && !task.controlCommand && currentDevice.lastTask?.status === "queued") {
        currentDevice.lastTask = { status: "expired", step: 0, total: 1, category: "general", updatedAt: new Date().toISOString() };
        void saveStore();
      }
    }, 5 * 60 * 1000);
    task.expiryTimer.unref?.();
    dashboardTasks.set(device.id, task);
    if (!controlCommand) {
      device.lastTask = { status: "queued", step: 0, total: 1, category: "general", updatedAt: task.createdAt };
    }
    res.status(202).json({ taskId: task.id, expiresAt: new Date(task.expiresAt).toISOString() });
  });

  router.delete("/:deviceId/tasks", requireAuth, async (req, res) => {
    const device = getStore().devices.find((item) => item.id === req.params.deviceId && !item.revokedAt);
    if (!device) return res.status(404).json({ error: "Active paired device not found." });
    const task = dashboardTasks.get(device.id);
    if (!task) return res.status(404).json({ error: "There is no queued task to cancel." });
    dashboardTasks.delete(device.id);
    clearDashboardTaskTimer(task);
    if (!task.controlCommand) {
      device.lastTask = { status: "cancelled", step: 0, total: 1, category: "general", updatedAt: new Date().toISOString() };
      await saveStore();
    }
    res.json({ ok: true });
  });

  router.post("/tasks/next", requireDeviceAuth, (req, res) => {
    const device = req.jarvisDevice;
    device.lastSeenAt = new Date().toISOString();
    device.backgroundVoiceActive = true;
    const task = dashboardTasks.get(device.id);
    if (!task) return res.json({ task: null });
    if (task.expiresAt <= Date.now()) {
      dashboardTasks.delete(device.id);
      clearDashboardTaskTimer(task);
      if (!task.controlCommand) {
        device.lastTask = { status: "expired", step: 0, total: 1, category: "general", updatedAt: new Date().toISOString() };
      }
      return res.json({ task: null });
    }
    dashboardTasks.delete(device.id);
    clearDashboardTaskTimer(task);
    if (!task.controlCommand) {
      device.lastTask = { status: "review", step: 0, total: 1, category: "general", updatedAt: new Date().toISOString() };
    }
    res.json({ task: { id: task.id, message: task.message } });
  });

  router.post("/task-status", requireDeviceAuth, async (req, res) => {
    const device = req.jarvisDevice;
    const status = cleanText(req.body?.status, 24);
    if (!DEVICE_TASK_STATES.has(status)) return res.status(400).json({ error: "Task status is not supported." });
    const step = Number(req.body?.step);
    const total = Number(req.body?.total);
    if (!Number.isInteger(step) || step < 0 || step > 6 || !Number.isInteger(total) || total < 1 || total > 6 || step > total) {
      return res.status(400).json({ error: "Task progress is outside the supported range." });
    }
    const category = cleanText(req.body?.category, 24);
    if (!DEVICE_TASK_CATEGORIES.has(category)) return res.status(400).json({ error: "Task category is not supported." });
    device.lastSeenAt = new Date().toISOString();
    device.lastTask = { status, step, total, category, updatedAt: new Date().toISOString() };
    await saveStore();
    res.json({ ok: true, device: publicDevice(device) });
  });

  router.delete("/:deviceId", requireAuth, async (req, res) => {
    const device = getStore().devices.find((item) => item.id === req.params.deviceId);
    if (!device) return res.status(404).json({ error: "Device not found." });
    if (!device.revokedAt) {
      device.revokedAt = new Date().toISOString();
      clearDashboardTaskTimer(dashboardTasks.get(device.id));
      dashboardTasks.delete(device.id);
      await saveStore();
    }
    res.json({ ok: true, device: publicDevice(device) });
  });

  router.post("/heartbeat", requireDeviceAuth, async (req, res) => {
    const device = req.jarvisDevice;
    device.lastSeenAt = new Date().toISOString();
    if (typeof req.body?.accessibilityEnabled === "boolean") {
      device.accessibilityEnabled = req.body.accessibilityEnabled;
    }
    if (typeof req.body?.appVersion === "string") {
      device.appVersion = cleanText(req.body.appVersion, 40);
    }
    if (typeof req.body?.backgroundVoiceActive === "boolean") {
      device.backgroundVoiceActive = req.body.backgroundVoiceActive;
    }
    await saveStore();
    res.json({ ok: true, device: publicDevice(device) });
  });

  router.post("/plan", requireDeviceAuth, async (req, res) => {
    const message = cleanText(req.body?.message, 3000);
    if (!message) return res.status(400).json({ error: "Voice transcript cannot be empty." });
    if (typeof createAgentPlan !== "function") {
      return res.status(503).json({ error: "The AI planner is not configured on this server." });
    }
    try {
      const plan = await createAgentPlan(message);
      res.json({ ...plan, externalAI: plan.externalAI === true });
    } catch (error) {
      if (error?.code === "AI_NOT_CONFIGURED") {
        return res.status(503).json({ error: error.message, code: error.code });
      }
      console.error("Device AI planning failed:", error?.name || "Error");
      res.status(502).json({ error: "JARVIS could not create a safe device-action plan." });
    }
  });

  router.post("/voice-command", requireDeviceAuth, async (req, res) => {
    const message = cleanText(req.body?.message, 4000);
    if (!message) return res.status(400).json({ error: "Voice transcript cannot be empty." });
    const applicationId = req.body?.applicationId === undefined
      ? "android-companion"
      : normalizeApplicationId(req.body.applicationId);
    if (!applicationId || applicationId === "*") {
      return res.status(400).json({ error: "Foreground application ID is invalid." });
    }
    try {
      const result = await runDeviceVoiceCommand(message, req.jarvisDevice, applicationId);
      res.json(typeof result === "string"
        ? { answer: result, engine: "built-in-offline", externalAI: false }
        : result);
    } catch (error) {
      console.error("Device voice request failed:", error?.name || "Error");
      res.status(500).json({ error: "JARVIS could not process this voice request." });
    }
  });

  return router;
}
