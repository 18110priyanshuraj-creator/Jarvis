const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_RETRY_ATTEMPTS = 2;
const MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 12000;

function boundedInteger(value, fallback, min, max) {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return fallback;
  return Math.min(max, Math.max(min, Number(raw)));
}

function isGeminiEndpoint(rawBaseUrl) {
  try {
    return new URL(rawBaseUrl).hostname.toLowerCase() === "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
}

function readGeminiApiKeys() {
  const numbered = [];
  for (let index = 1; index <= 7; index++) {
    const value = String(
      process.env[`JARVIS_GEMINI_API_KEY_${index}`] ||
      process.env[`GEMINI_API_KEY_${index}`] ||
      ""
    ).trim();
    if (value && !numbered.includes(value)) numbered.push(value);
  }
  if (numbered.length) return numbered;
  return [
    process.env.JARVIS_GEMINI_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.JARVIS_AI_API_KEY
  ].map(value => String(value || "").trim()).filter((value, index, all) =>
    value && all.indexOf(value) === index
  );
}

function readConfiguration() {
  const rawBaseUrl = String(process.env.JARVIS_AI_BASE_URL || "").trim();
  const model = String(process.env.JARVIS_AI_MODEL || "").trim();
  const runtime = String(process.env.JARVIS_AI_RUNTIME || "external").trim().toLowerCase() === "self-hosted"
    ? "self-hosted" : "external";
  const nodeEnv = String(process.env.NODE_ENV || "development").trim();
  const geminiProvider = isGeminiEndpoint(rawBaseUrl);
  let baseUrl = null;
  let baseUrlValid = false;
  let loopback = false;
  if (rawBaseUrl) {
    try {
      const parsed = new URL(rawBaseUrl);
      loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase());
      const secureProtocol = parsed.protocol === "https:";
      const localDevelopmentHttp = parsed.protocol === "http:" && loopback && nodeEnv !== "production";
      const cleanUrl = !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
      if ((secureProtocol || localDevelopmentHttp) && cleanUrl) {
        parsed.pathname = parsed.pathname.replace(/\/+$/, "");
        baseUrl = parsed.toString().replace(/\/+$/, "");
        baseUrlValid = true;
      }
    } catch {
      // Invalid URLs are reported through safe readiness metadata only.
    }
  }
  const modelValid = MODEL_PATTERN.test(model);
  const apiKeys = geminiProvider
    ? readGeminiApiKeys()
    : [String(process.env.JARVIS_AI_API_KEY || "").trim()].filter(Boolean);
  const keyRequirementMet = loopback && nodeEnv !== "production" ? true : apiKeys.length > 0;
  const configured = baseUrlValid && modelValid && keyRequirementMet;
  const enabled = process.env.JARVIS_AI_ENABLED === "true";
  const requestTimeoutMs = boundedInteger(process.env.JARVIS_AI_REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5000, 60000);
  const retryAttempts = boundedInteger(process.env.JARVIS_AI_RETRY_ATTEMPTS, DEFAULT_RETRY_ATTEMPTS, 1, 3);
  return {
    baseUrl, apiKeys, model, runtime, geminiProvider, modelValid, baseUrlValid, configured, enabled,
    requestTimeoutMs, retryAttempts,
    conversationEnabled: configured && enabled && process.env.JARVIS_AI_CHAT_ENABLED === "true",
    plannerEnabled: configured && enabled && process.env.JARVIS_AI_PLANNER_ENABLED === "true"
  };
}

export function getAIProviderStatus() {
  const config = readConfiguration();
  return {
    provider: config.geminiProvider
      ? "google-gemini"
      : (config.runtime === "self-hosted" ? "jarvis-self-hosted" : "openai-compatible"),
    runtime: config.runtime,
    configured: config.configured,
    baseUrlConfigured: config.baseUrlValid,
    modelValid: config.modelValid,
    model: config.configured ? config.model : "not-configured",
    enabled: config.enabled,
    conversationEnabled: config.conversationEnabled,
    plannerEnabled: config.plannerEnabled,
    keyCount: config.apiKeys.length,
    failoverEnabled: config.apiKeys.length > 1,
    requestTimeoutMs: config.requestTimeoutMs,
    retryAttempts: config.retryAttempts
  };
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) {
    throw new TypeError("AI messages must contain between one and twenty entries.");
  }
  const normalized = [];
  for (const item of messages) {
    if (!item || !["system", "user", "assistant"].includes(item.role)) continue;
    const content = typeof item.content === "string" ? item.content.trim().slice(0, MAX_MESSAGE_CHARS) : "";
    if (content) normalized.push({ role: item.role, content });
  }
  if (!normalized.length) throw new TypeError("AI messages cannot be empty.");
  return normalized;
}

function extractMessageText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.filter(part => part && (part.type === "text" || typeof part.text === "string"))
    .map(part => String(part.text || "").trim()).filter(Boolean).join("\n").trim();
}

function providerError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  if (Number.isInteger(status)) error.status = status;
  return error;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calls a server-configured OpenAI-compatible chat-completions endpoint.
 * Gemini deployments may provide up to seven independent API keys. Credentials,
 * provider URL, model, headers and tool definitions are never caller-controlled.
 */
export async function createChatCompletion(messages, options = {}, fetchImpl = globalThis.fetch) {
  const config = readConfiguration();
  if (!config.configured || !config.enabled) {
    throw providerError("The independent AI provider is not configured or enabled on the server.", "AI_NOT_CONFIGURED");
  }
  if (typeof fetchImpl !== "function") {
    throw providerError("This server runtime does not provide HTTP fetch support.", "AI_FETCH_UNAVAILABLE");
  }
  const safeMessages = normalizeMessages(messages);
  const endpoint = config.baseUrl + "/chat/completions";
  const requestBody = {
    model: config.model,
    messages: safeMessages,
    temperature: Number.isFinite(options.temperature) ? Math.min(1, Math.max(0, options.temperature)) : 0.2,
    max_tokens: Number.isInteger(options.maxTokens) ? Math.min(4000, Math.max(64, options.maxTokens)) : 1200,
    stream: false
  };
  if (options.responseFormat?.type === "json_object") requestBody.response_format = { type: "json_object" };

  const keys = config.apiKeys.length ? config.apiKeys : [""];
  const rotateKeys = config.geminiProvider && keys.length > 1;
  const maxAttempts = rotateKeys ? keys.length : config.retryAttempts;
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const apiKey = rotateKeys ? keys[attempt] : (keys[0] || "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    let response;
    let networkFailure = false;
    try {
      const headers = { "Content-Type": "application/json", "Accept": "application/json" };
      if (apiKey) headers.Authorization = "Bearer " + apiKey;
      if (config.geminiProvider) headers["x-goog-api-client"] = "jarvis-personal-assistant/1.0.0";
      response = await fetchImpl(endpoint, {
        method: "POST", headers, body: JSON.stringify(requestBody),
        cache: "no-store", redirect: "error", signal: controller.signal
      });
    } catch (error) {
      networkFailure = true;
      lastError = error?.name === "AbortError"
        ? providerError("The AI provider request timed out.", "AI_PROVIDER_TIMEOUT")
        : providerError("The AI provider could not be reached.", "AI_PROVIDER_NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
    }

    if (response) {
      if (!response.ok) {
        const statusAllowsRotation = rotateKeys && [401, 403].includes(response.status);
        const retryable = statusAllowsRotation || [408, 429, 500, 502, 503, 504].includes(response.status);
        lastError = providerError(
          retryable
            ? "The AI provider key is unavailable or the service is temporarily busy."
            : "The AI provider rejected the request. Check its server configuration.",
          retryable ? "AI_PROVIDER_TEMPORARY_ERROR" : "AI_PROVIDER_REQUEST_ERROR",
          response.status
        );
        if (!retryable) throw lastError;
      } else {
        let payload;
        try { payload = await response.json(); }
        catch { throw providerError("The AI provider returned an unreadable response.", "AI_PROVIDER_INVALID_RESPONSE"); }
        const content = extractMessageText(payload?.choices?.[0]?.message?.content);
        if (!content) throw providerError("The AI provider returned an empty or unsupported response.", "AI_PROVIDER_EMPTY_RESPONSE");
        return {
          content: content.slice(0, 12000),
          provider: config.geminiProvider
            ? "google-gemini"
            : (config.runtime === "self-hosted" ? "jarvis-self-hosted" : "openai-compatible"),
          model: config.model
        };
      }
    }

    if (attempt + 1 < maxAttempts && !rotateKeys) await sleep(200 * (attempt + 1));
    if (networkFailure && rotateKeys && attempt + 1 >= maxAttempts) break;
  }
  throw lastError || providerError("The AI provider request failed.", "AI_PROVIDER_ERROR");
}
