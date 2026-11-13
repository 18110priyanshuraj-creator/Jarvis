import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMediaProject, buildMediaCopilotPrompt, parseMediaSceneRewrite } from "../public/media-copilot.js";

const project = {
  title: "A science explainer",
  format: "vertical-short",
  platform: "youtube-shorts",
  language: "hinglish",
  tone: "friendly",
  durationSeconds: 28,
  scenes: [
    { heading: "The mystery", voiceover: "Kabhi socha hai ki aisa kyun hota hai?", onScreenText: "Why does this happen?", visualPrompt: "A curious student", durationSeconds: 8 },
    { heading: "The answer", voiceover: "", onScreenText: "", visualPrompt: "A simple diagram", durationSeconds: 20 }
  ],
  tracks: [{ id: "track-main-video", clips: [{ sceneId: "s1" }] }, { kind: "audio", clips: [] }]
};

test("media audit identifies missing narration, long beats and missing timeline links", () => {
  const report = analyzeMediaProject(project);
  assert.ok(report.score < 100);
  assert.ok(report.findings.some((item) => item.title.includes("no narration")));
  assert.ok(report.findings.some((item) => item.title.includes("feel slow")));
  assert.ok(report.findings.some((item) => item.title.includes("not on the main timeline")));
});

test("copilot prompt contains project context and states its media inspection limit", () => {
  const prompt = buildMediaCopilotPrompt({ project, scene: project.scenes[0], question: "Improve this intro" });
  assert.match(prompt, /context-aware copilot/i);
  assert.match(prompt, /underlying media file/i);
  assert.match(prompt, /A science explainer/);
});

test("scene rewrite parser accepts valid JSON output", () => {
  const result = parseMediaSceneRewrite('{"heading":"A better hook","voiceover":"A concise narration","onScreenText":"Look closer","visualPrompt":"Show a clear diagram"}');
  assert.equal(result.heading, "A better hook");
  assert.equal(result.onScreenText, "Look closer");
});

test("scene rewrite parser rejects invalid and incomplete output", () => {
  assert.equal(parseMediaSceneRewrite("I think you should change the intro"), null);
  assert.equal(parseMediaSceneRewrite('{"heading":"Only a title"}'), null);
});
