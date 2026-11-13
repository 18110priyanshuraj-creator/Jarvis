import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCaptionSrt,
  normalizeCaptionCues,
  normalizeCaptionStyle,
  parseTimedCaptionFile
} from "../public/media-captions.js";

test("imports SRT captions, strips cue markup, and normalizes timestamps", () => {
  const cues = parseTimedCaptionFile(
    "1\n00:00:01,250 --> 00:00:03,500\n<b>Hello</b> &amp; welcome\n\n2\n00:00:04,000 --> 00:00:05,250\nSecond line",
    20
  );
  assert.equal(cues.length, 2);
  assert.deepEqual([cues[0].startSeconds, cues[0].endSeconds], [1.25, 3.5]);
  assert.equal(cues[0].text, "Hello & welcome");
});

test("imports WebVTT cues with optional cue ids and cue settings", () => {
  const cues = parseTimedCaptionFile(
    "WEBVTT\n\nintro\n00:00.500 --> 00:02.000 align:start\n<v Speaker>Hello there</v>\n\n00:02.000 --> 00:04.000\nNext line",
    10
  );
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startSeconds, 0.5);
  assert.equal(cues[0].text, "Hello there");
  assert.equal(cues[1].endSeconds, 4);
});

test("caption normalization clamps to timeline and drops invalid or empty cues", () => {
  const cues = normalizeCaptionCues([
    { id: "a", startSeconds: 1, endSeconds: 3, text: "  Valid  " },
    { id: "b", startSeconds: 4, endSeconds: 3, text: "Backwards" },
    { id: "c", startSeconds: 9, endSeconds: 15, text: "Clamped", },
    { id: "d", startSeconds: 1, endSeconds: 2, text: "" }
  ], 10);
  assert.equal(cues.length, 2);
  assert.equal(cues[1].endSeconds, 10);
  assert.equal(cues[0].text, "Valid");
});

test("duplicate caption ids are made unique and cues remain chronologically ordered", () => {
  const cues = normalizeCaptionCues([
    { id: "same", startSeconds: 5, endSeconds: 6, text: "Later" },
    { id: "same", startSeconds: 1, endSeconds: 2, text: "Earlier" }
  ], 10);
  assert.equal(cues[0].text, "Earlier");
  assert.notEqual(cues[0].id, cues[1].id);
});

test("caption SRT export preserves imported cue timing", () => {
  const srt = formatCaptionSrt([
    { startSeconds: 1.25, endSeconds: 3.5, text: "Hello world" }
  ], 10);
  assert.equal(srt, "1\n00:00:01,250 --> 00:00:03,500\nHello world\n");
});

test("invalid files and unsupported caption styles are handled safely", () => {
  assert.throws(() => parseTimedCaptionFile("not a subtitle", 30), /No valid timed subtitle cues/i);
  assert.throws(() => parseTimedCaptionFile(""), /non-empty/i);
  assert.deepEqual(normalizeCaptionStyle({ preset: "unexpected", position: "right", size: "huge" }), {
    preset: "bold-box", position: "bottom", size: "medium"
  });
});
