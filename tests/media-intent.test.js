import test from "node:test";
import assert from "node:assert/strict";
import { parseMediaCreationIntent } from "../public/media-intent.js";

test("detects a Hinglish stick-figure video request and selects the story preset", () => {
  const intent = parseMediaCreationIntent("Jarvis, mere liye stick figure animation video banao");
  assert.ok(intent);
  assert.equal(intent.visualStyle, "stick-figure-story");
  assert.equal(intent.language, "hinglish");
  assert.equal(intent.format, "vertical-short");
});

test("detects topic-based English video creation and extracts the subject as title", () => {
  const intent = parseMediaCreationIntent("Create a short video about the water cycle for YouTube Shorts");
  assert.ok(intent);
  assert.equal(intent.title, "the water cycle for YouTube Shorts");
  assert.equal(intent.platform, "youtube-shorts");
});

test("detects long-form landscape explainer requests", () => {
  const intent = parseMediaCreationIntent("Make a landscape explainer video about renewable energy");
  assert.ok(intent);
  assert.equal(intent.format, "landscape-explainer");
});

test("does not turn how-to questions or third-party app commands into Media Studio drafts", () => {
  assert.equal(parseMediaCreationIntent("How do I make an animation?"), null);
  assert.equal(parseMediaCreationIntent("Can you explain how to create a video?"), null);
  assert.equal(parseMediaCreationIntent("Teach me how to edit a video"), null);
  assert.equal(parseMediaCreationIntent("Canva mein stick figure animation banao"), null);
  assert.equal(parseMediaCreationIntent("Open CapCut"), null);
  assert.equal(parseMediaCreationIntent("Hello Jarvis"), null);
});
