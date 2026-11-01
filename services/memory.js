import crypto from "node:crypto";

const MAX_CONTENT = 500;
const MAX_MEMORIES = 200;
const VALID_CATEGORIES = new Set(["preference", "goal", "fact"]);
const SENSITIVE_MEMORY_PATTERN = /(?:\b|_)(password|passcode|pin|otp|one[- ]time code|api[_ -]?key|secret|access[_ -]?token|private key|bank account|card number|medical|health|diagnos(?:is|ed)|medicine|medication|home address|exact address|phone number|email address)\b/i;
const GOOGLE_API_KEY = /\bAIza[0-9A-Za-z_-]{30,}\b/;
const LONG_BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/i;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeTimestamp(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function memoryHash(content) {
  return crypto.createHash("sha256")
    .update(content.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
}

export function isSafeMemoryContent(content) {
  const value = cleanText(content, MAX_CONTENT);
  return value.length >= 3 &&
    !SENSITIVE_MEMORY_PATTERN.test(value) &&
    !GOOGLE_API_KEY.test(value) &&
    !LONG_BEARER.test(value);
}

export function normalizeMemory(input = {}) {
  const content = cleanText(input.content, MAX_CONTENT).replace(/\s+/g, " ");
  if (!isSafeMemoryContent(content)) {
    throw new TypeError("For privacy, JARVIS does not save secrets or sensitive personal information as memory.");
  }

  const now = new Date().toISOString();
  const category = VALID_CATEGORIES.has(input.category) ? input.category : "fact";
  const createdAt = normalizeTimestamp(input.createdAt, now);
  const updatedAt = normalizeTimestamp(input.updatedAt, createdAt);

  return {
    id: cleanText(input.id, 80) || crypto.randomUUID(),
    content,
    category,
    contentHash: memoryHash(content),
    createdAt,
    updatedAt
  };
}

export function isDuplicateMemory(memories, candidate) {
  const hash = candidate?.contentHash || memoryHash(candidate?.content || "");
  return (Array.isArray(memories) ? memories : []).some((item) => {
    const existingHash = item?.contentHash || memoryHash(item?.content || "");
    return Boolean(item?.content) && existingHash === hash;
  });
}

export function searchMemories(memories, query = "", category = "", limit = 100) {
  const records = Array.isArray(memories) ? memories : [];
  const cleanQuery = cleanText(query, 300).normalize("NFKC").toLocaleLowerCase();
  const allowedCategory = VALID_CATEGORIES.has(category) ? category : "";
  const boundedLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;

  const filtered = records.filter((item) => !allowedCategory || item.category === allowedCategory);
  if (!cleanQuery) {
    return filtered.slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      .slice(0, boundedLimit);
  }

  const terms = [...new Set(cleanQuery.match(/[\p{L}\p{N}]+/gu) || [])].filter((term) => term.length > 1);
  if (!terms.length) return [];

  return filtered.map((item) => {
    const content = String(item?.content || "").normalize("NFKC").toLocaleLowerCase();
    const categoryText = String(item?.category || "").toLocaleLowerCase();
    const score = terms.reduce((total, term) => {
      return total + (content.includes(term) ? 2 : 0) + (categoryText.includes(term) ? 1 : 0);
    }, 0) + (content.includes(cleanQuery) ? 4 : 0);
    return { ...item, score };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .slice(0, boundedLimit);
}

export function buildMemoryContext(memories, query, limit = 5) {
  return searchMemories(memories, query, "", limit).map(({ id, content, category, createdAt, updatedAt }) => ({
    id,
    content,
    category,
    createdAt,
    updatedAt
  }));
}

export const MEMORY_LIMITS = Object.freeze({
  items: MAX_MEMORIES,
  content: MAX_CONTENT
});
