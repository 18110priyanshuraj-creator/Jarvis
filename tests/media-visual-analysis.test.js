import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMediaVisualAnalysisMessages,
  normalizeMediaVisualAnalysisInput,
  normalizeMediaVisualAnalysisResponse
} from "../services/media-visual-analysis.js";

const pixel = "data:image/jpeg;base64," + "A".repeat(200);
const base = {
  project: { title: "City explainer", format: "vertical-short", platform: "youtube-shorts", language: "hinglish", durationSeconds: 35 },
  question: "Review the visual flow.",
  frames: [
    { timestampSeconds: 2, dataUrl: pixel },
    { timestampSeconds: 17, dataUrl: pixel },
    { timestampSeconds: 31, dataUrl: pixel }
  ],
  audioAnalysis: {
    durationSeconds: 35,
    silenceSegments: [{ startSeconds: 8, endSeconds: 9.2, durationSeconds: 1.2 }]
  }
};

test("visual analysis validates frames and preserves local audio pause candidates", () => {
  const input = normalizeMediaVisualAnalysisInput(base);
  assert.equal(input.frames.length, 3);
  assert.equal(input.audioAnalysis.silenceSegments[0].durationSeconds, 1.2);
});

test("visual analysis rejects remote URLs, invalid timestamps and excessive frame payloads", () => {
  assert.throws(() => normalizeMediaVisualAnalysisInput({
    ...base, frames: [{ timestampSeconds: 1, dataUrl: "https://example.com/frame.jpg" }, base.frames[1]]
  }), /small JPEG/i);
  assert.throws(() => normalizeMediaVisualAnalysisInput({
    ...base, frames: [base.frames[1], base.frames[0]]
  }), /ascending order/i);
  assert.throws(() => normalizeMediaVisualAnalysisInput({
    ...base, frames: base.frames.map(frame => ({ ...frame, dataUrl: "data:image/jpeg;base64," + "A".repeat(181000) }))
  }), /small JPEG/i);
});

test("AI request includes text and image frames without embedding the original video", () => {
  const input = normalizeMediaVisualAnalysisInput(base);
  const messages = buildMediaVisualAnalysisMessages(input);
  assert.equal(messages[1].content.filter(part => part.type === "image_url").length, 3);
  assert.match(messages[1].content[0].text, /low-volume intervals/i);
  assert.match(messages[1].content[0].text, /City explainer/);
});

test("visual analysis response is normalized and bounded", () => {
  const report = normalizeMediaVisualAnalysisResponse(JSON.stringify({
    summary: "The second frame has a crowded title.",
    visualFindings: [{ timeSeconds: 17, severity: "warning", observation: "Title overlaps key subject.", recommendation: "Move the title into the upper safe area." }],
    editSuggestions: ["Shorten the second beat."],
    limitations: ["Only three still frames were reviewed."]
  }));
  assert.equal(report.visualFindings[0].severity, "warning");
  assert.equal(report.editSuggestions.length, 1);
});

test("visual analysis response rejects malformed model output", () => {
  assert.throws(() => normalizeMediaVisualAnalysisResponse("not JSON"), /valid visual-analysis report/i);
});
