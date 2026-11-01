import crypto from "node:crypto";

const MAX_TITLE = 180;
const MAX_CONTENT = 8000;
const MAX_TAGS = 10;
const MAX_SOURCES = 10;
const MAX_SOURCE_SNIPPET = 1000;
const MAX_CITATIONS = 20;
const MAX_REVIEW_NOTE = 500;
const CATEGORIES = new Set(["general", "education", "science", "technology", "project", "other"]);
const SECRET_ASSIGNMENT = /(?:\b|_)(?:api[_ -]?key|access[_ -]?token|password|passcode|one[- ]time code|otp|private key)\b\s*[:=]\s*\S+/i;
const GOOGLE_API_KEY = /\bAIza[0-9A-Za-z_-]{30,}\b/;
const LONG_BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/i;
const TRUSTED_REVIEW_STATES = new Set(["user-authored", "user-reviewed"]);
const SENSITIVE_URL_PARAMETER = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|auth|signature|sig)(?:$|[_-])/i;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validTimestamp(value, fallback = new Date().toISOString()) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function preserveDateLabel(value) {
  const raw = cleanText(value, 80);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : raw;
}

function normalizeTags(value) {
  const input = Array.isArray(value)
    ? value
    : typeof value === "string" ? value.split(",") : [];
  const tags = [];
  const seen = new Set();
  for (const raw of input) {
    const tag = cleanText(raw, 40).replace(/\s+/g, " ");
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return [];
  const sources = [];
  const seen = new Set();
  for (const item of value.slice(0, MAX_SOURCES * 3)) {
    const rawUrl = cleanText(item?.url || item?.uri, 2000);
    let parsed;
    try { parsed = new URL(rawUrl); } catch { continue; }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) continue;
    if ([...parsed.searchParams.keys()].some((key) => SENSITIVE_URL_PARAMETER.test(key))) continue;
    parsed.hash = "";
    const url = parsed.href;
    if (seen.has(url)) continue;
    seen.add(url);
    const candidateSnippet = cleanText(item?.snippet, MAX_SOURCE_SNIPPET);
    const snippet = SECRET_ASSIGNMENT.test(candidateSnippet) ||
      GOOGLE_API_KEY.test(candidateSnippet) || LONG_BEARER.test(candidateSnippet)
      ? "" : candidateSnippet;
    sources.push({
      title: cleanText(item?.title, 180) || parsed.hostname,
      url,
      domain: parsed.hostname,
      ...(snippet ? { snippet } : {}),
      publishedAt: preserveDateLabel(item?.publishedAt),
      retrievedAt: preserveDateLabel(item?.retrievedAt)
    });
    if (sources.length >= MAX_SOURCES) break;
  }
  return sources;
}

function normalizeCitations(value, sources) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(sources.map((item) => item.url));
  return value.slice(0, MAX_CITATIONS).map((item) => {
    const sourceUrls = Array.isArray(item?.sourceUrls)
      ? [...new Set(item.sourceUrls.map((url) => {
          const value = cleanText(url, 2000);
          try {
            const parsed = new URL(value);
            if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
            parsed.hash = "";
            return parsed.href;
          } catch {
            return "";
          }
        }).filter((url) => allowed.has(url)))].slice(0, 5)
      : [];
    return {
      claim: cleanText(item?.claim, 500),
      sourceUrls
    };
  }).filter((item) => item.claim && item.sourceUrls.length);
}

function fingerprint(title, content) {
  const normalized = [title, content]
    .map((part) => part.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim())
    .join("\n");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function normalizeKnowledgeItem(input = {}) {
  const title = cleanText(input.title, MAX_TITLE);
  const content = cleanText(input.content, MAX_CONTENT);
  if (!title || !content) {
    throw new TypeError("Knowledge needs both a title and content.");
  }
  if (SECRET_ASSIGNMENT.test(title + "\n" + content) || GOOGLE_API_KEY.test(content) || LONG_BEARER.test(content)) {
    throw new TypeError("JARVIS will not save content that appears to contain a credential or secret.");
  }

  const sourceKind = input.sourceKind === "web-research" ? "web-research" : "manual";
  const sources = normalizeSources(input.sources);
  const citations = normalizeCitations(input.citations, sources);
  const category = CATEGORIES.has(input.category) ? input.category : "general";
  const createdAt = validTimestamp(input.createdAt);
  const updatedAt = validTimestamp(input.updatedAt, createdAt);
  const reviewStatus = sourceKind !== "web-research"
    ? "user-authored"
    : input.reviewStatus === "user-reviewed" ? "user-reviewed"
      : input.reviewStatus === "rejected" ? "rejected" : "unreviewed";

  return {
    id: cleanText(input.id, 80) || crypto.randomUUID(),
    title,
    content,
    category,
    tags: normalizeTags(input.tags),
    sourceKind,
    sourceQuery: cleanText(input.sourceQuery, 1200),
    sources,
    citations,
    reviewStatus,
    reviewNote: reviewStatus === "rejected" ? cleanText(input.reviewNote, MAX_REVIEW_NOTE) : "",
    reviewedAt: reviewStatus === "user-reviewed" ? validTimestamp(input.reviewedAt, updatedAt) : null,
    rejectedAt: reviewStatus === "rejected" ? validTimestamp(input.rejectedAt, updatedAt) : null,
    capturedAt: validTimestamp(input.capturedAt, createdAt),
    contentHash: fingerprint(title, content),
    createdAt,
    updatedAt
  };
}

export function searchKnowledgeItems(items, query = "", limit = 100) {
  const records = Array.isArray(items) ? items : [];
  const cleanQuery = cleanText(query, 300).normalize("NFKC").toLocaleLowerCase();
  const boundedLimit = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20;
  if (!cleanQuery) {
    return records.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, boundedLimit);
  }

  const terms = [...new Set(cleanQuery.match(/[\p{L}\p{N}]+/gu) || [])].filter((term) => term.length > 1);
  if (!terms.length) return [];

  return records.map((item) => {
    const title = String(item?.title || "").normalize("NFKC").toLocaleLowerCase();
    const tags = (Array.isArray(item?.tags) ? item.tags : []).join(" ").toLocaleLowerCase();
    const body = [
      item?.content || "",
      item?.sourceQuery || "",
      item?.category || "",
      tags
    ].join(" ").normalize("NFKC").toLocaleLowerCase();
    const score = terms.reduce((total, term) => {
      let value = 0;
      if (title.includes(term)) value += 6;
      if (tags.includes(term)) value += 4;
      if (body.includes(term)) value += 1;
      return total + value;
    }, 0) + (title.includes(cleanQuery) ? 8 : 0);
    return { ...item, score };
  }).filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, boundedLimit);
}

/**
 * Only user-authored notes and web research explicitly reviewed by the user
 * enter AI context. Unreviewed and rejected entries remain searchable in the
 * library but cannot silently influence an assistant answer.
 */
export function buildKnowledgeContext(items, query, limit = 3) {
  const trustedItems = (Array.isArray(items) ? items : [])
    .filter((item) => TRUSTED_REVIEW_STATES.has(item?.reviewStatus));
  return searchKnowledgeItems(trustedItems, query, limit).map((item) => ({
    title: item.title,
    category: item.category,
    content: cleanText(item.content, 1800),
    sourceKind: item.sourceKind,
    reviewStatus: item.reviewStatus,
    capturedAt: item.capturedAt,
    sources: item.sources.map((source) => ({
      title: source.title,
      url: source.url,
      publishedAt: source.publishedAt,
      retrievedAt: source.retrievedAt
    }))
  }));
}

export function isDuplicateKnowledge(items, candidate) {
  const hash = candidate?.contentHash || fingerprint(candidate?.title || "", candidate?.content || "");
  return (Array.isArray(items) ? items : []).some((item) => item?.contentHash === hash);
}

/**
 * Merge new provenance for an explicitly re-saved duplicate without creating
 * another library record or silently changing its review decision.
 */
export function mergeDuplicateKnowledge(existing, candidate, updatedAt = new Date().toISOString()) {
  if (!existing || !candidate || !isDuplicateKnowledge([existing], candidate)) {
    throw new TypeError("Knowledge entries do not have matching normalized content.");
  }
  const sources = [...(Array.isArray(existing.sources) ? existing.sources : []), ...(Array.isArray(candidate.sources) ? candidate.sources : [])];
  const citations = [...(Array.isArray(existing.citations) ? existing.citations : []), ...(Array.isArray(candidate.citations) ? candidate.citations : [])];
  const tags = [...(Array.isArray(existing.tags) ? existing.tags : []), ...(Array.isArray(candidate.tags) ? candidate.tags : [])];
  return normalizeKnowledgeItem({
    ...existing,
    sources,
    citations,
    tags,
    sourceQuery: existing.sourceQuery || candidate.sourceQuery,
    capturedAt: existing.capturedAt || candidate.capturedAt,
    reviewStatus: existing.reviewStatus,
    reviewNote: existing.reviewNote,
    reviewedAt: existing.reviewedAt,
    rejectedAt: existing.rejectedAt,
    updatedAt
  });
}

export function isKnowledgeContextTrusted(item) {
  return TRUSTED_REVIEW_STATES.has(item?.reviewStatus);
}

export const KNOWLEDGE_LIMITS = Object.freeze({
  items: 300,
  title: MAX_TITLE,
  content: MAX_CONTENT,
  tags: MAX_TAGS,
  sources: MAX_SOURCES,
  sourceSnippet: MAX_SOURCE_SNIPPET,
  citations: MAX_CITATIONS,
  reviewNote: MAX_REVIEW_NOTE
});
