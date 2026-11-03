import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKnowledgeItem } from "../services/knowledge.js";
import {
  createLearningNote,
  parseExplicitLearningCommand,
  previewIndependentLearning
} from "../services/learning-engine.js";

test("only explicit Learn/Teach/Sikhao commands create learning intents", () => {
  assert.equal(parseExplicitLearningCommand("Explain Newton's laws"), null);
  assert.equal(parseExplicitLearningCommand("I want to learn physics"), null);
  assert.deepEqual(
    parseExplicitLearningCommand("Learn: Newton's third law | Forces occur in equal and opposite pairs."),
    {
      matched: true,
      title: "Newton's third law",
      content: "Forces occur in equal and opposite pairs."
    }
  );
  const hindi = parseExplicitLearningCommand("Sikhao: Mole concept\nOne mole contains approximately 6.022 × 10²³ entities.");
  assert.equal(hindi.title, "Mole concept");
  assert.match(hindi.content, /6\.022/);
});

test("malformed, oversized, or sensitive learning commands are rejected without truncation", () => {
  assert.match(parseExplicitLearningCommand("Learn: only a title").error, /format/i);
  assert.match(parseExplicitLearningCommand("Learn: | no title").error, /title/i);
  assert.match(parseExplicitLearningCommand("Learn: Long | " + "x".repeat(501)).error, /500 characters/i);
  assert.equal(parseExplicitLearningCommand("Learn: Private | My password is abc123").blocked, true);
  assert.equal(parseExplicitLearningCommand("Teach JARVIS: Contact | My email address is learner@example.com").blocked, true);
});

test("a user-taught lesson is stored as user-authored and can be retrieved offline", () => {
  const created = createLearningNote([], {
    title: "JEE kinematics",
    content: "Average velocity equals total displacement divided by total time."
  }, "2026-11-03T12:00:00.000Z");

  assert.equal(created.duplicate, false);
  assert.equal(created.item.reviewStatus, "user-authored");
  assert.ok(created.item.tags.includes("user-taught"));

  const preview = previewIndependentLearning([created.item], "Explain average velocity");
  assert.equal(preview.counts.included, 1);
  assert.equal(preview.contextItems[0].title, "JEE kinematics");
  assert.equal(preview.policy.externalAIRequired, false);
  assert.equal(preview.policy.modelTraining, false);
});

test("duplicate teaching does not silently alter a prior web-research review decision", () => {
  const existing = normalizeKnowledgeItem({
    title: "Newton's third law",
    content: "Forces occur in equal and opposite pairs.",
    sourceKind: "web-research",
    reviewStatus: "rejected",
    reviewNote: "The source was not suitable.",
    sources: [{ title: "Source", url: "https://example.org/newton" }]
  });
  const result = createLearningNote([existing], {
    title: "Newton's third law",
    content: "Forces occur in equal and opposite pairs."
  }, "2026-11-03T12:00:00.000Z");

  assert.equal(result.duplicate, true);
  assert.equal(result.item.reviewStatus, "rejected");
  assert.equal(result.item.sourceKind, "web-research");
});

test("learning preview excludes unreviewed and rejected web research", () => {
  const items = [
    normalizeKnowledgeItem({
      title: "Photosynthesis",
      content: "Chlorophyll absorbs light energy used in photosynthesis.",
      sourceKind: "manual"
    }),
    normalizeKnowledgeItem({
      title: "Photosynthesis unreviewed",
      content: "A web summary that still needs review.",
      sourceKind: "web-research",
      sources: [{ url: "https://example.org/unreviewed" }]
    }),
    normalizeKnowledgeItem({
      title: "Photosynthesis rejected",
      content: "A web summary that the owner rejected.",
      sourceKind: "web-research",
      reviewStatus: "rejected",
      sources: [{ url: "https://example.org/rejected" }]
    })
  ];

  const preview = previewIndependentLearning(items, "photosynthesis");
  assert.equal(preview.counts.matched, 3);
  assert.equal(preview.counts.included, 1);
  assert.equal(preview.counts.awaitingReview, 1);
  assert.equal(preview.counts.rejected, 1);
  assert.equal(preview.contextItems[0].reviewStatus, "user-authored");
});
