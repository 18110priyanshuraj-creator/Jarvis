import crypto from "node:crypto";
import path from "node:path";

export const DOCUMENT_LIMITS = Object.freeze({
  files: 120,
  fileBytes: 15 * 1024 * 1024,
  totalBytes: 200 * 1024 * 1024,
  title: 180,
  fileName: 160,
  collection: 60,
  description: 1000,
  tags: 12,
  tagLength: 32,
  indexedText: 20000,
  query: 300,
  contextItems: 2,
  contextChars: 2400
});

const MIME_EXTENSIONS = Object.freeze({
  "text/plain": ["txt"],
  "text/markdown": ["md", "markdown"],
  "text/csv": ["csv"],
  "application/json": ["json"],
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a"],
  "audio/wav": ["wav"],
  "audio/ogg": ["ogg"],
  "audio/webm": ["weba"],
  "video/mp4": ["mp4"],
  "video/webm": ["webm"]
});
const TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
const REVIEW_STATES = new Set(["unreviewed", "user-reviewed", "rejected"]);
const SECRET_PATTERN = /(?:\b|_)(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passcode|one[- ]time code|otp|private key)\b\s*[:=]\s*\S+/i;
const GOOGLE_API_KEY = /\bAIza[0-9A-Za-z_-]{30,}\b/;
const LONG_BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/i;
const SENSITIVE_PATTERN = /(?:\b|_)(?:medical diagnosis|medical condition|health condition|exact address|street address|home address|phone number|email address|date of birth|bank account|card number|religion|political party|sexual orientation|mental health)\b/i;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function timestamp(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function safeDescription(value) {
  const text = cleanText(value, DOCUMENT_LIMITS.description).replace(/\s+/g, " ");
  if (SECRET_PATTERN.test(text) || GOOGLE_API_KEY.test(text) || LONG_BEARER.test(text) || SENSITIVE_PATTERN.test(text)) {
    throw new TypeError("JARVIS will not save a document description that appears to contain a secret or sensitive personal information.");
  }
  return text;
}

export function sanitizeDocumentFileName(value) {
  const leaf = cleanText(value, 300).replace(/\\/g, "/").split("/").pop() || "";
  const name = leaf
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._()\[\] -]/gu, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, DOCUMENT_LIMITS.fileName);
  return name || "document";
}

function extensionOf(fileName) {
  const match = sanitizeDocumentFileName(fileName).toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match?.[1] || "";
}

function verifyMagic(bytes, mimeType) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) return false;
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (mimeType === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mimeType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "video/mp4" || mimeType === "audio/mp4") return bytes.subarray(4, 8).toString("ascii") === "ftyp";
  if (mimeType === "video/webm" || mimeType === "audio/webm") return starts(0x1a, 0x45, 0xdf, 0xa3);
  if (mimeType === "audio/wav") return bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WAVE";
  if (mimeType === "audio/ogg") return bytes.subarray(0, 4).toString("ascii") === "OggS";
  if (mimeType === "audio/mpeg") return bytes.subarray(0, 3).toString("ascii") === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (TEXT_MIME_TYPES.has(mimeType)) {
    // Reject known binary signatures even when the header bytes are valid UTF-8.
    const prefix = bytes.subarray(0, 12);
    if (prefix.subarray(0, 5).toString("ascii") === "%PDF-" ||
        prefix.subarray(0, 4).toString("ascii") === "RIFF" ||
        prefix.subarray(0, 4).toString("hex") === "504b0304" ||
        starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ||
        starts(0xff, 0xd8, 0xff) ||
        prefix.subarray(4, 8).toString("ascii") === "ftyp" ||
        starts(0x1a, 0x45, 0xdf, 0xa3)) return false;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return !text.includes(String.fromCharCode(0));
    } catch { return false; }
  }
  return false;
}

export function getDocumentType(mimeType, fileName) {
  const allowed = MIME_EXTENSIONS[mimeType];
  const extension = extensionOf(fileName);
  if (!allowed || !allowed.includes(extension)) {
    throw new TypeError("This file type or extension is not supported. Use TXT, Markdown, CSV, JSON, PDF, common images, audio or video.");
  }
  return {
    mimeType,
    extension,
    indexingMode: TEXT_MIME_TYPES.has(mimeType) ? "text" : "metadata-only"
  };
}

export function extractDocumentText(bytes, mimeType) {
  if (!TEXT_MIME_TYPES.has(mimeType)) return "";
  if (!Buffer.isBuffer(bytes) || bytes.length > DOCUMENT_LIMITS.fileBytes) {
    throw new TypeError("The document body is invalid or exceeds the upload limit.");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new TypeError("This text document is not valid UTF-8. Export it as UTF-8 and try again.");
  }
  if (text.includes("\u0000")) throw new TypeError("This text document contains binary data.");
  if (mimeType === "application/json") {
    try { JSON.parse(text); } catch { throw new TypeError("The JSON document is not valid JSON."); }
  }
  text = text.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new TypeError("The text document is empty.");
  if (SECRET_PATTERN.test(text) || GOOGLE_API_KEY.test(text) || LONG_BEARER.test(text) || SENSITIVE_PATTERN.test(text)) {
    throw new TypeError("JARVIS will not index a document that appears to contain a secret or sensitive personal information.");
  }
  return text.slice(0, DOCUMENT_LIMITS.indexedText);
}

export function createKnowledgeDocument(input, bytes, now = new Date().toISOString()) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > DOCUMENT_LIMITS.fileBytes) {
    throw new TypeError("Choose a non-empty file no larger than 15 MiB.");
  }
  const fileName = sanitizeDocumentFileName(input?.fileName);
  const type = getDocumentType(cleanText(input?.mimeType, 100).toLowerCase(), fileName);
  if (!verifyMagic(bytes, type.mimeType)) {
    throw new TypeError("The file contents do not match the selected file type.");
  }
  const title = cleanText(input?.title, DOCUMENT_LIMITS.title) ||
    fileName.replace(/\.[^.]+$/, "").slice(0, DOCUMENT_LIMITS.title);
  if (!title || SECRET_PATTERN.test(title) || GOOGLE_API_KEY.test(title) || LONG_BEARER.test(title) || SENSITIVE_PATTERN.test(title)) {
    throw new TypeError("Enter a safe document title without secrets or sensitive personal information.");
  }
  const description = safeDescription(input?.description);
  const tags = normalizeDocumentTags(input?.tags);
  const collection = cleanText(input?.collection, DOCUMENT_LIMITS.collection).replace(/[<>]/g, "").trim() || "Unsorted";
  const extractedText = extractDocumentText(bytes, type.mimeType);
  const id = crypto.randomUUID();
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const createdAt = timestamp(now, new Date().toISOString());

  return normalizeKnowledgeDocument({
    id,
    title,
    fileName,
    mimeType: type.mimeType,
    extension: type.extension,
    byteSize: bytes.length,
    sha256,
    storageKey: id + "." + type.extension,
    collection,
    tags,
    description,
    extractedText,
    indexingMode: type.indexingMode,
    reviewStatus: "unreviewed",
    createdAt,
    updatedAt: createdAt
  });
}

export function normalizeDocumentTags(value) {
  const input = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const result = [];
  const seen = new Set();
  for (const raw of input) {
    const tag = cleanText(raw, DOCUMENT_LIMITS.tagLength).replace(/[<>]/g, "").replace(/\s+/g, " ");
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    if (SECRET_PATTERN.test(tag) || GOOGLE_API_KEY.test(tag) || LONG_BEARER.test(tag)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= DOCUMENT_LIMITS.tags) break;
  }
  return result;
}

export function normalizeKnowledgeDocument(input = {}) {
  const fileName = sanitizeDocumentFileName(input.fileName);
  const type = getDocumentType(cleanText(input.mimeType, 100).toLowerCase(), fileName);
  const id = cleanText(input.id, 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TypeError("Document ID is invalid.");
  const byteSize = Number(input.byteSize);
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > DOCUMENT_LIMITS.fileBytes) {
    throw new TypeError("Document size is invalid.");
  }
  const sha256 = cleanText(input.sha256, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError("Document fingerprint is invalid.");
  const storageKey = cleanText(input.storageKey, 100);
  if (storageKey !== id + "." + type.extension) throw new TypeError("Document storage key is invalid.");
  const title = cleanText(input.title, DOCUMENT_LIMITS.title);
  if (!title || SECRET_PATTERN.test(title) || GOOGLE_API_KEY.test(title) || LONG_BEARER.test(title) || SENSITIVE_PATTERN.test(title)) {
    throw new TypeError("Document title is invalid.");
  }
  const createdAt = timestamp(input.createdAt, new Date().toISOString());
  const reviewStatus = REVIEW_STATES.has(input.reviewStatus) ? input.reviewStatus : "unreviewed";
  const updatedAt = timestamp(input.updatedAt, createdAt);
  const extractedText = cleanText(input.extractedText, DOCUMENT_LIMITS.indexedText);
  if (SECRET_PATTERN.test(extractedText) || GOOGLE_API_KEY.test(extractedText) || LONG_BEARER.test(extractedText) || SENSITIVE_PATTERN.test(extractedText)) {
    throw new TypeError("Document text is invalid.");
  }
  return {
    id,
    title,
    fileName,
    mimeType: type.mimeType,
    extension: type.extension,
    byteSize,
    sha256,
    storageKey,
    collection: cleanText(input.collection, DOCUMENT_LIMITS.collection).replace(/[<>]/g, "").trim() || "Unsorted",
    tags: normalizeDocumentTags(input.tags),
    description: safeDescription(input.description),
    extractedText,
    indexingMode: type.indexingMode,
    reviewStatus,
    reviewNote: reviewStatus === "rejected" ? cleanText(input.reviewNote, 500) : "",
    reviewedAt: reviewStatus === "user-reviewed" ? timestamp(input.reviewedAt, updatedAt) : null,
    rejectedAt: reviewStatus === "rejected" ? timestamp(input.rejectedAt, updatedAt) : null,
    createdAt,
    updatedAt
  };
}

export function findDuplicateDocument(items, candidate) {
  return (Array.isArray(items) ? items : []).find((item) => item?.sha256 === candidate?.sha256) || null;
}

export function searchKnowledgeDocuments(items, query = "", collection = "", review = "all", limit = 100) {
  const cleanQuery = cleanText(query, DOCUMENT_LIMITS.query).normalize("NFKC").toLocaleLowerCase();
  const cleanCollection = cleanText(collection, DOCUMENT_LIMITS.collection).toLocaleLowerCase();
  const allowedReview = REVIEW_STATES.has(review) ? review : "all";
  const boundedLimit = Number.isInteger(limit) ? Math.min(DOCUMENT_LIMITS.files, Math.max(1, limit)) : 50;
  const terms = [...new Set(cleanQuery.match(/[\p{L}\p{N}]+/gu) || [])].filter((term) => term.length > 1);
  return (Array.isArray(items) ? items : []).map((item) => {
    const haystack = [
      item.title, item.fileName, item.collection, item.description,
      ...(Array.isArray(item.tags) ? item.tags : []), item.extractedText
    ].join(" ").normalize("NFKC").toLocaleLowerCase();
    const score = terms.length ? terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0) : 1;
    return { ...item, score };
  }).filter((item) =>
    item.score > 0 &&
    (!cleanCollection || item.collection.toLocaleLowerCase() === cleanCollection) &&
    (allowedReview === "all" || item.reviewStatus === allowedReview)
  ).sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, boundedLimit);
}

export function buildDocumentKnowledgeContext(items, query, limit = DOCUMENT_LIMITS.contextItems) {
  const cleanQuery = cleanText(query, DOCUMENT_LIMITS.query).normalize("NFKC").toLocaleLowerCase();
  if (!cleanQuery) return [];
  return searchKnowledgeDocuments(items, cleanQuery, "", "user-reviewed", limit)
    .filter((item) => item.indexingMode === "text" || item.description)
    .map((item) => ({
      title: item.title,
      category: item.collection,
      content: [item.description, item.extractedText].filter(Boolean).join("\n\n").slice(0, DOCUMENT_LIMITS.contextChars),
      sourceKind: "user-document",
      reviewStatus: "user-reviewed",
      sources: [],
      fileName: item.fileName
    }));
}

export function resolveDocumentStoragePath(directory, document) {
  const root = path.resolve(directory);
  const filePath = path.resolve(root, document.storageKey);
  if (path.dirname(filePath) !== root || filePath === root) throw new TypeError("Document storage path is invalid.");
  return filePath;
}

export function toPublicKnowledgeDocument(document) {
  const { storageKey, ...publicRecord } = document;
  return {
    ...publicRecord,
    extractedText: publicRecord.extractedText.slice(0, 2400)
  };
}
