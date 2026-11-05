import test from "node:test";
import assert from "node:assert/strict";
import {
  makeCreatorPlan,
  makeStickFigureSvg,
  makeCreatorStoryboardCsv,
  makeCreatorScriptMarkdown
} from "../public/creator-studio.js";

test("long-form chapter plan totals the selected duration and has contiguous chapters", () => {
  for (const minutes of [4, 6, 8, 10, 12, 15, 20]) {
    const plan = makeCreatorPlan({
      topic: "Why metal feels colder than wood",
      audience: "Curious beginners",
      language: "hi-IN",
      duration: String(minutes)
    });
    assert.equal(plan.totalSeconds, minutes * 60);
    assert.equal(plan.chapters.reduce((sum, chapter) => sum + chapter.durationSeconds, 0), minutes * 60);
    assert.equal(plan.chapters[0].startSeconds, 0);
    for (let index = 1; index < plan.chapters.length; index += 1) {
      assert.equal(plan.chapters[index].startSeconds, plan.chapters[index - 1].endSeconds);
    }
    assert.equal(plan.chapters.at(-1).endSeconds, minutes * 60);
  }
});

test("plan rejects a vague or too-short topic", () => {
  assert.throws(() => makeCreatorPlan({ topic: "physics" }), /specific topic/i);
});

test("stick-figure SVG uses a supported pose and escapes label text", () => {
  const svg = makeStickFigureSvg("point", "<script>alert(1)</script>");
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.match(svg, /Pointing/);
  assert.match(svg, /&lt;script&gt;/);
  assert.doesNotMatch(svg, /<script>/);
});

test("storyboard CSV and script exports include all chapter markers", () => {
  const plan = makeCreatorPlan({ topic: "How a bicycle gear changes effort", duration: "8" });
  const csv = makeCreatorStoryboardCsv(plan);
  const markdown = makeCreatorScriptMarkdown(plan, "This is an original narration draft.");
  assert.equal(csv.split("\n").length, plan.chapters.length + 1);
  assert.match(csv, /Cold open \/ hook/);
  assert.match(markdown, /## Chapter plan/);
  assert.match(markdown, /This is an original narration draft/);
  assert.match(markdown, /Publishing checklist/);
});
