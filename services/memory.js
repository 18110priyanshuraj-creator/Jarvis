import crypto from "node:crypto";

const MAX_CONTENT = 500;
const MAX_MEMORIES = 200;
const MAX_CONTEXT_ITEMS = 5;
const MAX_CONTEXT_CHARS = 1800;
const VALID_CATEGORIES = new Set(["preference", "goal", "fact"]);
const SENSITIVE_MEMORY_PATTERN = /(?:\b|_)(password|passcode|pin|otp|one[- ]time code|api[_ -]?key|secret|access[_ -]?token|private key|bank account|card number|medical|health|diagnos(?:is|ed)|medicine|medication|home address|exact address|street address|phone number|email address|date of birth|birth date|race|ethnicity|religion|religious belief|political affiliation|political party|voting preference|sexual orientation|sexuality|sex life|trade union|union membership|criminal history|immigration status|biometric|mental health|disability)\b/i;
const GOOGLE_API_KEY = /\bAIza[0-9A-Za-z_-]{30,}\b/;
const LONG_BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/i;
const SEARCH_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "could",
  "did", "do", "does", "for", "from", "had", "has", "have", "how", "i",
  "if", "in", "into", "is", "it", "its", "me", "my", "of", "on", "or",
  "our", "please", "the", "their", "them", "there", "these", "this", "those",
  "to", "us", "was", "we", "were", "what", "when", "where", "which", "who",
  "why", "will", "with", "would", "you", "your", "jarvis", "remember",
  "hai", "hain", "ka", "ki", "ke", "ko", "mein", "me", "mai", "main",
  "mera", "meri", "mere", "mujhe", "mujhko", "kya", "kyu", "kyon", "aur",
  "ye", "yeh", "woh", "wo", "par", "se", "bhi", "ek", "tha", "thi", "the",
  "है", "हैं", "का", "की", "के", "को", "में", "मैं", "मेरा", "मेरी",
  "मुझे", "क्या", "और", "यह", "वह", "पर", "से", "भी", "एक"
]);

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeTimestamp(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function normalizedSearchText(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value) {
  return normalizedSearchText(value).match(/[\p{L}\p{N}]+/gu) || [];
}

function queryTerms(value) {
  return [...new Set(tokenize(value))]
    .filter((term) => term.length > 1 && !SEARCH_STOP_WORDS.has(term));
}

function memoryHash(content) {
  return crypto.createHash("sha256")
    .update(normalizedSearchText(content))
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
    // Existing records default to enabled so upgrades preserve prior behaviour.
    // Users can pause a note without deleting it.
    enabled: input.enabled !== false,
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
  const normalized = cleanText(message, 4000).replace(/^jarvis[,:]?\s*/i, "");
  const match = normalized.match(/^(?:please\s+)?forget(?:\s+(?:that|this))?\s*[:,-]?\s*(.*)$/i) ||
    normalized.match(/^(?:please\s+)?(?:bhool\s+jao|bhula\s+do|yaad\s+se\s+hatao|yaad\s+se\s+hata\s+do)\s*[:,-]?\s*(.*)$/i);
  if (!match) return null;

  const content = cleanText(match[1], MAX_CONTENT).normalize("NFKC").replace(/\s+/g, " ")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "").trim();
  const broadRequest = /^(all|everything|all memories|sab|sab kuch|saari memories|sabhi memories)$/i.test(content);
  return { content, ambiguous: broadRequest || content.length < 3 };
}

export function findExactMemory(memories, content) {
  const candidate = cleanText(content, MAX_CONTENT);
  if (candidate.length < 3) return null;
  const hash = memoryHash(candidate);
  return (Array.isArray(memories) ? memories : []).find((item) => {
    if (!item?.content) return false;
    const existingHash = item.contentHash || memoryHash(item.content);
    return existingHash === hash;
  }) || null;
}

function rankMemories(memories, query, category = "", limit = 100, includePaused = true) {
  const records = Array.isArray(memories) ? memories : [];
  const cleanQuery = cleanText(query, 4000);
  const normalizedQuery = normalizedSearchText(cleanQuery);
  const allowedCategory = VALID_CATEGORIES.has(category) ? category : "";
  const boundedLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;
  const filtered = records.filter((item) =>
    (!allowedCategory || item.category === allowedCategory) &&
    (includePaused || item.enabled !== false)
  );

  if (!cleanQuery) {
    return filtered.slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
      .slice(0, boundedLimit);
  }

  const terms = queryTerms(normalizedQuery);
  if (!terms.length) return [];

  return filtered.map((item) => {
    const normalizedContent = normalizedSearchText(item?.content);
    const contentTokens = [...new Set(tokenize(normalizedContent))];
    const categoryTokens = tokenize(item?.category || "");
    const matchedTerms = [];
    let score = 0;

    for (const term of terms) {
      if (contentTokens.includes(term)) {
        matchedTerms.push(term);
        score += 4;
      } else if (contentTokens.some((token) =>
        token.length >= 4 && (token.startsWith(term) || term.startsWith(token))
      )) {
        matchedTerms.push(term);
        score += 2;
      } else if (categoryTokens.includes(term)) {
        matchedTerms.push(term);
        score += 1;
      }
    }

    const coverage = matchedTerms.length / terms.length;
    const phraseMatch = normalizedContent.includes(normalizedQuery);
    const scoreWithPhrase = score + (phraseMatch ? 4 : 0);
    return {
      ...item,
      score: scoreWithPhrase,
      matchedTerms,
      relevance: Math.round(coverage * 100),
      coverage
    };
  }).filter((item) => item.score > 0 && item.coverage >= 0.34)
    .sort((a, b) =>
      b.score - a.score ||
      b.coverage - a.coverage ||
      String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))
    )
    .slice(0, boundedLimit);
}

export function searchMemories(memories, query = "", category = "", limit = 100) {
  return rankMemories(memories, query, category, limit, true);
}

export function buildMemoryContext(memories, query, limit = MAX_CONTEXT_ITEMS) {
  const boundedItems = Number.isInteger(limit) ? Math.min(MAX_CONTEXT_ITEMS, Math.max(1, limit)) : MAX_CONTEXT_ITEMS;
  const matches = rankMemories(memories, query, "", boundedItems, false);
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

export function previewMemoryContext(memories, query, limit = MAX_CONTEXT_ITEMS) {
  const boundedItems = Number.isInteger(limit) ? Math.min(MAX_CONTEXT_ITEMS, Math.max(1, limit)) : MAX_CONTEXT_ITEMS;
  const activeMatches = rankMemories(memories, query, "", boundedItems, false);
  const pausedMatches = rankMemories(
    (Array.isArray(memories) ? memories : []).filter((item) => item?.enabled === false),
    query,
    "",
    100,
    true
  );
  return {
    items: activeMatches.map(({ id, content, category, matchedTerms, score, relevance }) => ({
      id, content, category, matchedTerms, score, relevance
    })),
    pausedCount: pausedMatches.length
  };
}

export const MEMORY_LIMITS = Object.freeze({
  items: MAX_MEMORIES,
  content: MAX_CONTENT,
  contextItems: MAX_CONTEXT_ITEMS,
  contextChars: MAX_CONTEXT_CHARS
});
