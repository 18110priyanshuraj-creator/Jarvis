import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";

const PAIRING_CODE_TTL_MS = 3 * 60 * 1000;
const pairingChallenges = new Map();

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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

  router.get("/", requireAuth, (req, res) => {
    res.json({ devices: getStore().devices.map(publicDevice) });
  });

  router.delete("/:deviceId", requireAuth, async (req, res) => {
    const device = getStore().devices.find((item) => item.id === req.params.deviceId);
    if (!device) return res.status(404).json({ error: "Device not found." });
    if (!device.revokedAt) {
      device.revokedAt = new Date().toISOString();
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
      res.json({ ...plan, externalAI: true });
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
    try {
      const result = await runDeviceVoiceCommand(message, req.jarvisDevice);
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
