import crypto from "node:crypto";

export const EXPERIENCE_CATEGORIES = Object.freeze([
  "accuracy",
  "clarity",
  "tone",
  "relevance",
  "format",
  "other"
]);

const MAX_FEEDBACK_ITEMS = 300;
const MAX_PREFERENCES = 30;
const MAX_SUGGESTION_LENGTH = 500;

const UNSAFE_OR_PRIVATE_PATTERN =
  /\b(?:api[_ -]?key|password|passcode|bearer\s+[a-z0-9._-]{8,}|secret\s*[:=]|private key|ignore (?:all )?(?:previous )?(?:system )?instructions|reveal (?:credentials|secrets|passwords?)|bypass (?:authentication|security|permissions)|execute (?:arbitrary )?(?:code|shell)|run (?:shell|terminal|powershell) commands?|exfiltrat\w*|transfer money|make (?:a )?payment|place (?:an )?order)\b/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{8,}\d)/;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.normalize("NFKC").trim().slice(0, maxLength) : "";
}

function normalizeText(value) {
  return cleanText(value, MAX_SUGGESTION_LENGTH).toLocaleLowerCase().replace(/\s+/g, " ");
}

export function isSafeExperienceText(value) {
  const text = cleanText(value, MAX_SUGGESTION_LENGTH);
  return Boolean(text) && !UNSAFE_OR_PRIVATE_PATTERN.test(text) && !EMAIL_PATTERN.test(text) && !PHONE_PATTERN.test(text);
}

function normalizeCategory(value) {
  return EXPERIENCE_CATEGORIES.includes(value) ? value : "other";
}

function isoOrEmpty(value) {
  if (typeof value !== "string" || !value) return "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export function normalizeExperienceFeedback(input = {}) {
  const rating = input.rating === "up" ? "up" : input.rating === "down" ? "down" : "";
  if (!rating) throw new TypeError("Feedback rating must be up or down.");
  const suggestionRaw = cleanText(input.suggestion, MAX_SUGGESTION_LENGTH);
  const suggestion = suggestionRaw && isSafeExperienceText(suggestionRaw) ? suggestionRaw : "";
  const engine = ["gemini-conversation", "gemini-google-search", "built-in-offline", "built-in-offline-fallback"].includes(input.engine)
    ? input.engine
    : "unknown";
  return {
    id: cleanText(input.id, 80) || crypto.randomUUID(),
    rating,
    category: normalizeCategory(input.category),
    suggestion,
    engine,
    createdAt: isoOrEmpty(input.createdAt) || new Date().toISOString(),
    reviewedAt: isoOrEmpty(input.reviewedAt),
    preferenceId: cleanText(input.preferenceId, 80)
  };
}

export function normalizeExperiencePreference(input = {}) {
  const content = cleanText(input.content, MAX_SUGGESTION_LENGTH);
  if (content.length < 20 || !isSafeExperienceText(content)) {
    throw new TypeError("Preference must be 20–500 characters and must not contain private or unsafe content.");
  }
  return {
    id: cleanText(input.id, 80) || crypto.randomUUID(),
    category: normalizeCategory(input.category),
    content,
    sourceFeedbackId: cleanText(input.sourceFeedbackId, 80),
    active: input.active !== false,
    createdAt: isoOrEmpty(input.createdAt) || new Date().toISOString(),
    approvedAt: isoOrEmpty(input.approvedAt) || new Date().toISOString(),
    updatedAt: isoOrEmpty(input.updatedAt) || new Date().toISOString()
  };
}

export function promoteFeedbackToPreference(feedbackInput, preferences = []) {
  const feedback = normalizeExperienceFeedback(feedbackInput);
  if (feedback.rating !== "down") {
    throw new Error("Only feedback marked as needing work can become a response preference.");
  }
  if (feedback.preferenceId) throw new Error("This feedback has already been reviewed into a preference.");
  if (feedback.suggestion.length < 20) {
    throw new Error("Add a clear improvement suggestion of at least 20 characters first.");
  }
  if (!Array.isArray(preferences) || preferences.length >= MAX_PREFERENCES) {
    throw new Error("The response preference limit has been reached.");
  }
  const duplicate = preferences.find((item) =>
    normalizeText(item.content) === normalizeText(feedback.suggestion)
  );
  if (duplicate) throw new Error("This response preference is already saved.");

  const now = new Date().toISOString();
  const preference = normalizeExperiencePreference({
    category: feedback.category,
    content: feedback.suggestion,
    sourceFeedbackId: feedback.id,
    active: true,
    createdAt: now,
    approvedAt: now,
    updatedAt: now
  });
  return {
    preference,
    feedback: normalizeExperienceFeedback({
      ...feedback,
      reviewedAt: now,
      preferenceId: preference.id
    })
  };
}

export function setExperiencePreferenceActive(preferenceInput, active) {
  if (typeof active !== "boolean") throw new TypeError("Active state must be true or false.");
  const preference = normalizeExperiencePreference(preferenceInput);
  return normalizeExperiencePreference({
    ...preference,
    active,
    updatedAt: new Date().toISOString()
  });
}

export function getActiveExperienceContext(preferences, limit = 5) {
  if (!Array.isArray(preferences)) return [];
  return preferences.flatMap((raw) => {
    try {
      const preference = normalizeExperiencePreference(raw);
      if (!preference.active) return [];
      return [{
        category: preference.category,
        content: preference.content,
        approvedAt: preference.approvedAt
      }];
    } catch {
      return [];
    }
  }).slice(0, Math.min(5, Math.max(1, limit)));
}

export function summarizeExperience(feedback = [], preferences = []) {
  const safeFeedback = Array.isArray(feedback) ? feedback.flatMap((item) => {
    try { return [normalizeExperienceFeedback(item)]; } catch { return []; }
  }) : [];
  const safePreferences = Array.isArray(preferences) ? preferences.flatMap((item) => {
    try { return [normalizeExperiencePreference(item)]; } catch { return []; }
  }) : [];
  const categories = Object.fromEntries(EXPERIENCE_CATEGORIES.map((category) => [
    category,
    safeFeedback.filter((item) => item.rating === "down" && item.category === category).length
  ]));
  return {
    total: safeFeedback.length,
    helpful: safeFeedback.filter((item) => item.rating === "up").length,
    needsWork: safeFeedback.filter((item) => item.rating === "down").length,
    pendingSuggestions: safeFeedback.filter((item) => item.rating === "down" && item.suggestion.length >= 20 && !item.preferenceId).length,
    activePreferences: safePreferences.filter((item) => item.active).length,
    totalPreferences: safePreferences.length,
    categories
  };
}

export const EXPERIENCE_LIMITS = Object.freeze({
  feedback: MAX_FEEDBACK_ITEMS,
  preferences: MAX_PREFERENCES,
  suggestionLength: MAX_SUGGESTION_LENGTH
});
