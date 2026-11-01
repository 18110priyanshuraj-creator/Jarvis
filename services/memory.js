import crypto from "node:crypto";

const MAX_CONTENT = 500;
const MAX_MEMORIES = 200;
const MAX_CONTEXT_ITEMS = 5;
const MAX_CONTEXT_CHARS = 1800;
const VALID_CATEGORIES = new Set(["preference", "goal", "fact"]);
const SENSITIVE_MEMORY_PATTERN = /(?:\\b|_)(password|passcode|pin|otp|one[- ]time code|api[_ -]?key|secret|access[_ -]?token|private key|bank account|card number|medical|health|diagnos(?:is|ed)|medicine|medication|home address|exact address|street address|phone number|email address|date of birth|birth date|race|ethnicity|religion|religious belief|political affiliation|political party|voting preference|sexual orientation|sexuality|sex life|trade union|union membership|criminal history|immigration status|biometric|mental health|disability)\\b/i;
const GOOGLE_API_KEY = /\\bAIza[0-9A-Za-z_-]{30,}\\b/;
const LONG_BEARER = /\\bBearer\\s+[A-Za-z0-9._~+/-]{24,}/i;
const QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "could", "do", "does",
  "for", "from", "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "please",
  "should", "that", "the", "their", "this", "to", "was", "what", "when", "where", "which",
  "who", "why", "will", "with", "would", "you", "your", "hai", "hain", "ho", "hu", "hun",
  "ka", "kar", "karo", "karna", "ke", "ki", "kya", "ko", "mai", "mein", "mera", "meri",
  "mere", "mujhe", "par", "se", "tha", "thi", "the", "ye", "yeh"
]);

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeTimestamp(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function normalizedContent(value) {
  return cleanText(value, MAX_CONTENT).normalize("NFKC").replace(/\\s+/g, " ").trim();
}

function memoryHash(content) {
  return crypto.createHash("sha256")
    .update(normalizedContent(content).toLocaleLowerCase())
    .digest("hex");
}

function tokenize(value) {
  return [...new Set((String(value || "").normalize("NFKC").toLocaleLowerCase().match(/[\\p{L}\\p{N}]+/gu) || []))];
}

function queryTerms(value) {
  return tokenize(value).filter((term) =>
    !QUERY_STOP_WORDS.has(term) && (term.length > 2 || term === "ai" || term === "jee" || /^\\d{2,}$/.test(term))
  );
}

export function isSafeMemoryContent(content) {
  const value = cleanText(content, MAX_CONTENT);
  return value.length >= 3 &&
    !SENSITIVE_MEMORY_PATTERN.test(value) &&
    !GOOGLE_API_KEY.test(value) &&
    !LONG_BEARER.test(value);
}

export function normalizeMemory(input = {}) {
  const content = cleanText(input.content, MAX_CONTENT).replace(/\\s+/g, " ");
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

/**
 * Forget is intentionally exact-match only. An incomplete or broad request
 * never deletes records; the caller can ask the user to provide the saved note.
 */
export function parseExplicitForgetIntent(message) {
  const normalized = cleanText(message, 4000).replace(/^jarvis[,:]?\\s*/i, "");
  const match = normalized.match(/^(?:please\\s+)?forget(?:\\s+(?:that|this))?\\s*[:,-]?\\s*(.*)$/i) ||
    normalized.match(/^(?:please\\s+)?(?:bhool\\s+jao|bhula\\s+do|yaad\\s+se\\s+hatao|yaad\\s+se\\s+hata\\s+do)\\s*[:,-]?\\s*(.*)$/i);
  if (!match) return null;

  const content = normalizedContent(match[1]).replace(/^[\\"'“”‘’]+|[\\"'“”‘’]+$/gu, "").trim();
  const broadRequest = /^(all|everything|all memories|sab|sab kuch|saari memories|sabhi memories)$/i.test(content);
  return { content, ambiguous: broadRequest || content.length < 3 };
}

export function findExactMemory(memories, content) {
  const candidate = normalizedContent(content);
  if (candidate.length < 3) return null;
  const hash = memoryHash(candidate);
  return (Array.isArray(memories) ? memories : []).find((item) => {
    if (!item?.content) return false;
    const existingHash = item.contentHash || memoryHash(item.content);
    return existingHash === hash;
  }) || null;
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

  const terms = queryTerms(cleanQuery);
  if (!terms.length) return [];

  return filtered.map((item) => {
    const content = String(item?.content || "").normalize("NFKC").toLocaleLowerCase();
    const contentTokens = tokenize(content);
    const categoryTokens = tokenize(item?.category || "");
    let score = 0;
    let matchedTerms = 0;

    for (const term of terms) {
      if (contentTokens.includes(term)) {
        score += 4;
        matchedTerms += 1;
      } else if (contentTokens.some((token) => token.length >= 4 && (token.startsWith(term) || term.startsWith(token)))) {
        score += 2;
        matchedTerms += 1;
      } else if (categoryTokens.includes(term)) {
        score += 1;
        matchedTerms += 1;
      }
    }

    const coverage = matchedTerms / terms.length;
    if (content.includes(cleanQuery)) score += 4;
    return { ...item, score, relevance: Math.round(coverage * 100), coverage };
  }).filter((item) => item.score > 0 && item.coverage >= 0.34)
    .sort((a, b) => b.score - a.score ||
      b.coverage - a.coverage ||
      String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
    .slice(0, boundedLimit);
}

export function buildMemoryContext(memories, query, limit = MAX_CONTEXT_ITEMS) {
  const boundedItems = Number.isInteger(limit) ? Math.min(MAX_CONTEXT_ITEMS, Math.max(1, limit)) : MAX_CONTEXT_ITEMS;
  const matches = searchMemories(memories, query, "", boundedItems);
  const context = [];
  let remainingChars = MAX_CONTEXT_CHARS;

  for (const item of matches) {
    if (remainingChars < 3) break;
    const content = String(item.content || "").slice(0, remainingChars);
    if (content.length < 3) continue;
    context.push({
      id: item.id,
      content,
      category: item.category,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    });
    remainingChars -= content.length;
  }
  return context;
}

export const MEMORY_LIMITS = Object.freeze({
  items: MAX_MEMORIES,
  content: MAX_CONTENT,
  contextItems: MAX_CONTEXT_ITEMS,
  contextChars: MAX_CONTEXT_CHARS
});
