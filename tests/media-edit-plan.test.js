import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMediaEditPlan } from "../services/media-edit-plan.js";
import { normalizeMediaProject } from "../services/media-engine.js";
import { applyMediaEditOperations } from "../public/media-copilot.js";

function makeSafeProject() {
  return normalizeMediaProject({
    title: "Safe edit-plan fixture",
    brief: "Explain how the water cycle moves water through the environment.",
    format: "vertical-short",
    platform: "youtube-shorts",
    language: "en-IN",
    tone: "friendly",
    scenes: [
      {
        id: "safe-scene-opening",
        heading: "Original opening",
        voiceover: "Water moves through a repeating cycle in nature.",
        onScreenText: "The water cycle",
        visualPrompt: "A simple diagram showing water moving through the cycle.",
        durationSeconds: 8
      },
      {
        id: "safe-scene-summary",
        heading: "Summary",
        voiceover: "Evaporation, condensation, and precipitation keep water moving.",
        onScreenText: "Three connected steps",
        visualPrompt: "Three labeled arrows connecting the stages of the water cycle.",
        durationSeconds: 8
      }
    ]
  });
}

test("validates and safely applies a bounded JARVIS edit plan to a fixture project", () => {
  const project = makeSafeProject();
  const plan = normalizeMediaEditPlan({
    summary: "Clarify the opening and soften the final transition.",
    operations: [
      {
        type: "rewrite_scene",
        sceneId: "safe-scene-opening",
        heading: "Water keeps moving",
        voiceover: "Water travels through a repeating cycle across Earth.",
        onScreenText: "A cycle in motion",
        visualPrompt: "A clear, labeled diagram showing water moving through the cycle."
      },
      {
        type: "set_scene_transition",
        sceneId: "safe-scene-summary",
        transition: "fade"
      }
    ],
    notes: []
  }, project);

  const edited = applyMediaEditOperations(project, plan.operations);

  assert.equal(plan.operations.length, 2);
  assert.equal(edited.scenes[0].heading, "Water keeps moving");
  assert.equal(edited.scenes[0].voiceover, "Water travels through a repeating cycle across Earth.");
  assert.equal(edited.scenes[1].transition, "fade");
  assert.equal(project.scenes[0].heading, "Original opening");
  assert.notEqual(edited, project);
});

test("rejects unknown scene IDs, out-of-bounds moves, and unsupported operations", () => {
  const project = makeSafeProject();
  const firstClipId = project.tracks[0].clips[0].id;

  assert.throws(() => normalizeMediaEditPlan({
    operations: [{ type: "set_scene_transition", sceneId: "missing-scene", transition: "fade" }]
  }, project), /safe, actionable edit/i);

  assert.throws(() => normalizeMediaEditPlan({
    operations: [{ type: "move_clip", clipId: firstClipId, start: project.durationSeconds + 1 }]
  }, project), /safe, actionable edit/i);

  assert.throws(() => normalizeMediaEditPlan({
    operations: [{ type: "run_shell", command: "echo unsafe" }]
  }, project), /safe, actionable edit/i);

  assert.throws(() => applyMediaEditOperations(project, [
    { type: "run_shell", command: "echo unsafe" }
  ]), /unsupported operation/i);
});
