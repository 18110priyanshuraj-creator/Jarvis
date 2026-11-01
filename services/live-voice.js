import { GoogleGenAI } from "@google/genai";

const DEFAULT_LIVE_MODEL = "gemini-3.8-live";
const MODEL_PATTERN = /^[a-zA-Z0-9._-]{3,100}$/;
export const LIVE_SESSION_MAX_MS = 10 * 60 * 1000;
export const LIVE_TOKEN_TTL_MS = 12 * 60 * 1000;
export const LIVE_TOKEN_START_WINDOW_MS = 60 * 1000;

const LIVE_SYSTEM_INSTRUCTION = [
  "You are JARVIS, a helpful personal voice assistant.",
  "Speak naturally and concisely. Match the user's language; Hindi, Hinglish and English are all acceptable.",
  "Use clear, age-appropriate language. Explain uncertainty instead of inventing facts.",
  "This is conversation-only mode. You cannot open apps, control devices, send messages, access files, or perform external actions.",
  "Never claim that you completed an action outside this voice conversation.",
  "Do not ask for passwords, PINs, OTPs, API keys, payment details, or other secrets.",
  "Do not automatically save personal details from this conversation as long-term memory.",
  "For current information, clearly say when you cannot verify it live. For important health, legal, financial, or safety topics, encourage checking a trusted source or qualified person."
].join("\n");

export function getLiveVoiceConfiguration(env = process.env) {
  const apiKey = typeof env.GEMINI_API_KEY === "string" ? env.GEMINI_API_KEY.trim() : "";
  const model = String(env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL).trim();
  const modelValid = MODEL_PATTERN.test(model);
  const enabled = env.GEMINI_LIVE_VOICE_ENABLED === "true" && Boolean(apiKey) && modelValid;
  return {
    enabled,
    configured: Boolean(apiKey),
    optedIn: env.GEMINI_LIVE_VOICE_ENABLED === "true",
    model: modelValid ? model : "invalid-model",
    modelValid
  };
}

export function buildLiveVoiceConfig() {
  return {
    responseModalities: ["AUDIO"],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: {
      parts: [{ text: LIVE_SYSTEM_INSTRUCTION }]
    }
  };
}

export async function createLiveVoiceToken({
  apiKey,
  model = DEFAULT_LIVE_MODEL,
  createClient,
  now = Date.now()
} = {}) {
  const safeApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
  const safeModel = typeof model === "string" ? model.trim() : "";
  if (!safeApiKey) {
    const error = new Error("Gemini API key is not configured.");
    error.code = "LIVE_VOICE_NOT_CONFIGURED";
    throw error;
  }
  if (!MODEL_PATTERN.test(safeModel)) {
    const error = new Error("Gemini Live model identifier is invalid.");
    error.code = "LIVE_VOICE_INVALID_MODEL";
    throw error;
  }

  const client = createClient
    ? createClient(safeApiKey)
    : new GoogleGenAI({
        apiKey: safeApiKey,
        httpOptions: { apiVersion: "v1beta", timeout: 10000 }
      });

  const expireTime = new Date(now + LIVE_TOKEN_TTL_MS).toISOString();
  const newSessionExpireTime = new Date(now + LIVE_TOKEN_START_WINDOW_MS).toISOString();
  const result = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model: safeModel,
        config: buildLiveVoiceConfig()
      }
    }
  });

  if (!result || typeof result.name !== "string" || !result.name.trim()) {
    const error = new Error("Gemini did not return a Live API token.");
    error.code = "LIVE_VOICE_TOKEN_INVALID";
    throw error;
  }

  return {
    token: result.name,
    model: safeModel,
    expiresAt: expireTime,
    sessionStartExpiresAt: newSessionExpireTime
  };
}
