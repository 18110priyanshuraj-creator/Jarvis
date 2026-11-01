import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getActiveExperienceContext,
  isSafeExperienceText,
  normalizeExperienceFeedback,
  normalizeExperiencePreference,
  promoteFeedbackToPreference,
  setExperiencePreferenceActive,
  summarizeExperience
} from "../services/experience.js";

test("structured feedback keeps only allowed fields and never stores the prompt", () => {
  const record = normalizeExperienceFeedback({
    prompt: "This private conversation must not be stored.",
    rating: "down",
    category: "clarity",
    suggestion: "Explain difficult ideas one step at a time and include an example.",
    engine: "gemini-conversation"
  });
  assert.equal(record.rating, "down");
  assert.equal(record.category, "clarity");
  assert.equal(record.suggestion.includes("one step at a time"), true);
  assert.equal(Object.hasOwn(record, "prompt"), false);
  assert.equal(Object.hasOwn(record, "note"), false);
});

test("feedback with likely secrets or contact details does not keep suggestion text", () => {
  const record = normalizeExperienceFeedback({
    rating: "down",
    suggestion: "Use my email test@example.com to send me the answer."
  });
  assert.equal(record.suggestion, "");
  assert.equal(isSafeExperienceText("Use a concise explanation and one worked example."), true);
  assert.equal(isSafeExperienceText("My API key is secret: abc12345"), false);
});

test("feedback categories outside the allow-list normalize to other", () => {
  const record = normalizeExperienceFeedback({ rating: "up", category: "unknown-category" });
  assert.equal(record.category, "other");
});

test("only a constructive negative feedback item can become a preference", () => {
  const feedback = normalizeExperienceFeedback({
    id: "feedback-1",
    rating: "down",
    category: "clarity",
    suggestion: "Explain the main idea first, then show one simple example."
  });
  const result = promoteFeedbackToPreference(feedback, []);
  assert.equal(result.preference.active, true);
  assert.equal(result.preference.category, "clarity");
  assert.equal(result.feedback.preferenceId, result.preference.id);
  assert.ok(result.feedback.reviewedAt);
  assert.throws(() => promoteFeedbackToPreference(
    normalizeExperienceFeedback({ rating: "up", suggestion: "Explain with one useful example, please." }),
    []
  ), /only feedback marked as needing work/i);
});

test("short feedback suggestions cannot be promoted", () => {
  const feedback = normalizeExperienceFeedback({
    rating: "down",
    suggestion: "Be clearer."
  });
  assert.throws(() => promoteFeedbackToPreference(feedback, []), /at least 20 characters/i);
});

test("duplicate response preferences are rejected", () => {
  const feedback = normalizeExperienceFeedback({
    rating: "down",
    category: "format",
    suggestion: "Use short headings and simple bullet points for longer answers."
  });
  const existing = normalizeExperiencePreference({
    category: "format",
    content: "Use short headings and simple bullet points for longer answers."
  });
  assert.throws(() => promoteFeedbackToPreference(feedback, [existing]), /already saved/i);
});

test("pausing a preference immediately removes it from conversation context", () => {
  const preference = normalizeExperiencePreference({
    content: "Start explanations with a small summary and then add the details."
  });
  assert.equal(getActiveExperienceContext([preference]).length, 1);
  const paused = setExperiencePreferenceActive(preference, false);
  assert.equal(paused.active, false);
  assert.equal(getActiveExperienceContext([paused]).length, 0);
  assert.throws(() => setExperiencePreferenceActive(preference, "false"), /true or false/i);
});

test("experience summary reports aggregate counts without conversation text", () => {
  const feedback = [
    normalizeExperienceFeedback({ rating: "up" }),
    normalizeExperienceFeedback({ rating: "down", category: "clarity", suggestion: "Explain the key point in simpler words and include an example." }),
    normalizeExperienceFeedback({ rating: "down", category: "accuracy", suggestion: "Show the source date when giving information that can change." })
  ];
  const promoted = promoteFeedbackToPreference(feedback[1], []);
  feedback[1] = promoted.feedback;
  const summary = summarizeExperience(feedback, [promoted.preference]);
  assert.equal(summary.total, 3);
  assert.equal(summary.helpful, 1);
  assert.equal(summary.needsWork, 2);
  assert.equal(summary.pendingSuggestions, 1);
  assert.equal(summary.activePreferences, 1);
  assert.equal(summary.categories.clarity, 1);
  assert.equal(Object.hasOwn(summary, "prompts"), false);
});
