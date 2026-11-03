import {
  buildKnowledgeContext,
  isDuplicateKnowledge,
  isKnowledgeContextTrusted,
  KNOWLEDGE_LIMITS,
  mergeDuplicateKnowledge,
  normalizeKnowledgeItem,
  searchKnowledgeItems
} from "./knowledge.js";
import { isSafeMemoryContent } from "./memory.js";

const MAX_LEARNING_TITLE = KNOWLEDGE_LIMITS.title;
const MAX_LEARNING_CONTENT = 500;
const MAX_PREVIEW_QUERY = 300;
const LEARNING_CONTEXT_ITEMS = 3;

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function learningError(message, code = "LEARNING_INVALID") {
  return Object.assign(new TypeError(message), { code });
}

/**
 * Only a deliberate command is treated as teaching. Normal conversation,
 * questions, and feedback are never promoted to durable knowledge.
 *
 * Supported:
 *   Learn: <title> | <lesson>
 *   Teach JARVIS: <title> | <lesson>
 *   Sikhao: <title> | <lesson>
 */
export function parseExplicitLearningCommand(message) {
  const normalized = cleanText(message).replace(/^jarvis[,:]?\s*/i, "");
  const match = normalized.match(
    /^(?:please\s+)?(?:learn(?:\s+this)?|teach(?:\s+jarvis)?|sikhao(?:\s+jarvis)?)\s*:\s*([\s\S]*)$/i
  );
  if (!match) return null;

  const payload = match[1].trim();
  const pipe = payload.indexOf("|");
  const newline = payload.indexOf("\n");
  const separator = pipe >= 0 ? pipe : newline;

  if (separator < 0) {
    return {
      matched: true,
      error: "Use this format: Learn: <title> | <lesson (up to 500 characters)>. Nothing was saved."
    };
  }

  const title = cleanText(payload.slice(0, separator));
  const content = cleanText(payload.slice(separator + 1));
  if (!title || !content) {
    return {
      matched: true,
      error: "Add both a lesson title and its content. Format: Learn: <title> | <lesson>. Nothing was saved."
    };
  }
  if (title.length > MAX_LEARNING_TITLE) {
    return { matched: true, error: "Lesson titles must be 180 characters or fewer. Nothing was saved." };
  }
  if (content.length > MAX_LEARNING_CONTENT) {
    return { matched: true, error: "Chat lessons are limited to 500 characters. Save longer notes in the Knowledge screen. Nothing was saved." };
  }
  if (!isSafeMemoryContent(title) || !isSafeMemoryContent(content)) {
    return {
      matched: true,
      blocked: true,
      error: "I won't save content that may contain a secret or sensitive personal information. Nothing was saved."
    };
  }

  return { matched: true, title, content };
}

/**
 * Store a user-taught lesson in the existing Knowledge collection. The note is
 * explicitly user-authored, deduplicated, and immediately available to the
 * bounded offline retrieval path. No model weights or separate store change.
 */
export function createLearningNote(items, input, now = new Date().toISOString()) {
  const title = cleanText(input?.title);
  const content = cleanText(input?.content);
  if (!title || !content || title.length > MAX_LEARNING_TITLE ||
      content.length > MAX_LEARNING_CONTENT ||
      !isSafeMemoryContent(title) || !isSafeMemoryContent(content)) {
    throw learningError("The lesson is empty, too long, or contains private/sensitive information.");
  }

  const candidate = normalizeKnowledgeItem({
    title,
    content,
    category: "general",
    tags: ["user-taught", "independent-learning"],
    sourceKind: "manual",
    capturedAt: now,
    createdAt: now,
    updatedAt: now
  });

  const records = Array.isArray(items) ? items : [];
  const duplicateIndex = records.findIndex((item) => isDuplicateKnowledge([item], candidate));
  if (duplicateIndex >= 0) {
    const existing = records[duplicateIndex];
    const merged = mergeDuplicateKnowledge(existing, candidate, now);
    return {
      item: merged,
      duplicate: true,
      merged: JSON.stringify(merged) !== JSON.stringify(existing),
      index: duplicateIndex
    };
  }

  if (records.length >= KNOWLEDGE_LIMITS.items) {
    throw learningError("Knowledge Library is full. Delete an old entry before teaching another lesson.", "LEARNING_LIMIT");
  }

  return { item: candidate, duplicate: false, merged: false, index: -1 };
}

/**
 * Read-only preview of the exact bounded knowledge context available to the
 * offline assistant. Unreviewed and rejected web research is counted but never
 * returned as context.
 */
export function previewIndependentLearning(items, query) {
  const cleanQuery = cleanText(query);
  if (!cleanQuery) throw learningError("Enter a question to preview learned knowledge.");
  if (cleanQuery.length > MAX_PREVIEW_QUERY) {
    throw learningError("Preview questions must be 300 characters or fewer.");
  }

  const records = Array.isArray(items) ? items : [];
  const matches = searchKnowledgeItems(records, cleanQuery, KNOWLEDGE_LIMITS.items);
  const contextItems = buildKnowledgeContext(records, cleanQuery, LEARNING_CONTEXT_ITEMS);
  const trustedMatches = matches.filter(isKnowledgeContextTrusted).length;

  return {
    query: cleanQuery,
    contextItems,
    counts: {
      matched: matches.length,
      included: contextItems.length,
      awaitingReview: matches.filter((item) => item.reviewStatus === "unreviewed").length,
      rejected: matches.filter((item) => item.reviewStatus === "rejected").length,
      trustedBeyondLimit: Math.max(0, trustedMatches - contextItems.length)
    },
    policy: {
      retrieval: "keyword-based local retrieval",
      allowedContext: "user-authored notes and web research explicitly reviewed by the user",
      maximumContextItems: LEARNING_CONTEXT_ITEMS,
      externalAIRequired: false,
      modelTraining: false,
      automaticFactChecking: false,
      automaticSaving: false
    }
  };
}

export const LEARNING_LIMITS = Object.freeze({
  title: MAX_LEARNING_TITLE,
  content: MAX_LEARNING_CONTENT,
  previewQuery: MAX_PREVIEW_QUERY,
  contextItems: LEARNING_CONTEXT_ITEMS,
  items: KNOWLEDGE_LIMITS.items
});
