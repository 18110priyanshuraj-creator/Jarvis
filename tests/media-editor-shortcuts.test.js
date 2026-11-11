import test from "node:test";
import assert from "node:assert/strict";
import {
  clampMediaEditorTime,
  MEDIA_EDITOR_FRAME_SECONDS,
  MEDIA_EDITOR_SEEK_SECONDS,
  resolveMediaEditorShortcut
} from "../public/media-editor-shortcuts.js";

function key(key, extra = {}) {
  return resolveMediaEditorShortcut({ key, ...extra });
}

test("maps playback and common timeline navigation keys", () => {
  assert.deepEqual(key(" "), { action: "toggle-playback" });
  assert.deepEqual(key("k"), { action: "toggle-playback" });
  assert.deepEqual(key("j"), { action: "seek", deltaSeconds: -MEDIA_EDITOR_SEEK_SECONDS });
  assert.deepEqual(key("L"), { action: "seek", deltaSeconds: MEDIA_EDITOR_SEEK_SECONDS });
  assert.deepEqual(key("ArrowLeft"), { action: "seek", deltaSeconds: -MEDIA_EDITOR_FRAME_SECONDS });
  assert.deepEqual(key("ArrowRight"), { action: "seek", deltaSeconds: MEDIA_EDITOR_FRAME_SECONDS });
  assert.deepEqual(key("Home"), { action: "seek-start" });
  assert.deepEqual(key("End"), { action: "seek-end" });
});

test("ignores typing, composition, browser modifiers and handled events", () => {
  assert.equal(resolveMediaEditorShortcut({ key: "j" }, { isEditing: true }), null);
  assert.equal(key("j", { isComposing: true }), null);
  assert.equal(key("j", { ctrlKey: true }), null);
  assert.equal(key("j", { metaKey: true }), null);
  assert.equal(key("j", { altKey: true }), null);
  assert.equal(key("j", { defaultPrevented: true }), null);
  assert.equal(key("x"), null);
});

test("clamps seek results to the project duration and handles invalid values", () => {
  assert.equal(clampMediaEditorTime(4, 2, 5), 5);
  assert.equal(clampMediaEditorTime(1, -3, 5), 0);
  assert.equal(clampMediaEditorTime(1, 0.5, 5), 1.5);
  assert.equal(clampMediaEditorTime(NaN, 1, 5), 1);
  assert.equal(clampMediaEditorTime(2, 1, NaN), 0);
});
