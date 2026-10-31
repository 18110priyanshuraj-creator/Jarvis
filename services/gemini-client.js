import { GoogleGenAI } from "@google/genai";

const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_RETRY_ATTEMPTS = 2;
const MODEL_PATTERN = /^[a-zA-Z0-9._-]{3,100}$/;

let cachedClient;
let cachedClientSignature = "";

function boundedInteger(value, fallback, min, max) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return fallback;
  return Math.min(max, Math.max(min, Number(raw)));
}

function readConfiguration() {
  const apiKey = typeof process.env.GEMINI_API_KEY === "string"
    ? process.env.GEMINI_API_KEY.trim()
    : "";
  const model = String(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
  const modelValid = MODEL_PATTERN.test(model);
  const requestTimeoutMs = boundedInteger(
    process.env.GEMINI_REQUEST_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    5000,
    60000
  );
  const retryAttempts = boundedInteger(
    process.env.GEMINI_RETRY_ATTEMPTS,
    DEFAULT_RETRY_ATTEMPTS,
    1,
    3
  );
  return { apiKey, model, modelValid, requestTimeoutMs, retryAttempts };
}

export function getGeminiRuntimeStatus() {
  const config = readConfiguration();
  const configured = Boolean(config.apiKey);
  const ready = configured && config.modelValid;
  return {
    provider: "gemini",
    configured,
    model: config.modelValid ? config.model : "invalid-model",
    modelValid: config.modelValid,
    requestTimeoutMs: config.requestTimeoutMs,
    retryAttempts: config.retryAttempts,
    plannerEnabled: ready,
    conversationEnabled: ready && process.env.GEMINI_CHAT_ENABLED === "true",
    webResearchEnabled: ready && process.env.GEMINI_WEB_RESEARCH_ENABLED === "true"
  };
}

export function getGeminiModel() {
  const { model, modelValid } = readConfiguration();
  if (!modelValid) {
    throw new Error("GEMINI_MODEL must be a valid model identifier, for example gemini-3.8-flash.");
  }
  return model;
}

export function getGeminiClient() {
  const config = readConfiguration();
  if (!config.apiKey) return null;

  const signature = [
    config.apiKey,
    config.requestTimeoutMs,
    config.retryAttempts
  ].join("\u0000");

  if (!cachedClient || cachedClientSignature !== signature) {
    cachedClient = new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: {
        timeout: config.requestTimeoutMs,
        retryOptions: {
          attempts: config.retryAttempts,
          initialDelay: 0.5,
          maxDelay: 2,
          expBase: 2,
          jitter: 0.25,
          httpStatusCodes: [408, 429, 500, 502, 503, 504]
        }
      }
    });
    cachedClientSignature = signature;
  }

  return cachedClient;
}
