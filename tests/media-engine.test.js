import test from "node:test";
import assert from "node:assert/strict";
import {
  approveMediaProject,
  buildMediaCaptions,
  buildMediaScript,
  createMediaDraft,
  MEDIA_FORMATS,
  MEDIA_LIMITS,
  normalizeMediaProject,
  updateMediaProject
} from "../services/media-engine.js";

const brief = "Explain why the water cycle matters. Evaporation moves water into the air. Condensation forms clouds. Precipitation returns water to the ground.";

async function makeDraft(overrides = {}, options = {}) {
  return createMediaDraft({
    brief,
    format: "vertical-short",
    platform: "youtube-shorts",
    language: "en-IN",
    tone: "friendly",
    audience: "Students",
    ...overrides
  }, options);
}

test("creates a bounded local vertical-short storyboard without an external provider", async () => {
  const project = await makeDraft({ id: "caller-controlled" });
  assert.equal(project.status, "draft");
  assert.equal(project.generationSource, "local-template");
  assert.notEqual(project.id, "caller-controlled");
  assert.equal(project.format, "vertical-short");
  assert.equal(project.width, 720);
  assert.equal(project.height, 1280);
  assert.ok(project.scenes.length >= MEDIA_LIMITS.minScenes);
  assert.ok(project.scenes.length <= MEDIA_LIMITS.scenes);
  assert.ok(project.durationSeconds <= MEDIA_FORMATS["vertical-short"].maxDurationSeconds);
  assert.ok(project.scenes.every((scene, index) => scene.order === index + 1));
});

test("supports landscape explainers and square carousel cards", async () => {
  const landscape = await makeDraft({ format: "landscape-explainer", platform: "youtube" });
  const carousel = await makeDraft({ format: "square-carousel", platform: "instagram-carousel" });
  assert.deepEqual([landscape.width, landscape.height], [1280, 720]);
  assert.deepEqual([carousel.width, carousel.height], [1080, 1080]);
  assert.ok(carousel.scenes.every((scene) => scene.durationSeconds === 5));
});

test("creates editable stick-figure scenes with visual and motion metadata", async () => {
  const project = await makeDraft({ visualStyle: "stick-figure-story" });
  assert.equal(project.visualStyle, "stick-figure-story");
  assert.ok(project.scenes.every((scene) => scene.visualType === "stick-figure"));
  assert.ok(project.scenes.every((scene) => ["idle", "walk", "point", "think", "celebrate"].includes(scene.figurePose)));
  assert.ok(project.scenes.every((scene) => ["fade", "rise", "bounce", "walk", "gesture"].includes(scene.animation)));
  assert.ok(project.scenes.every((scene) => ["midnight", "sunset", "paper", "mint", "violet"].includes(scene.background)));
  assert.ok(project.scenes.every((scene) => ["cut", "fade", "slide", "wipe", "zoom"].includes(scene.transition)));
});

test("rejects unknown visual selectors by falling back to the supported design defaults", async () => {
  const project = await makeDraft({
    visualStyle: "arbitrary-html",
    scenes: undefined
  });
  assert.equal(project.visualStyle, "cinematic-motion");
  const normalized = normalizeMediaProject({
    title: "Fallbacks", brief,
    scenes: [
      { heading: "One", onScreenText: "One", visualType: "script", figurePose: "unknown", animation: "javascript", background: "url", transition: "execute" },
      { heading: "Two", onScreenText: "Two" }
    ]
  });
  assert.equal(normalized.scenes[0].visualType, "auto");
  assert.equal(normalized.scenes[0].figurePose, "walk");
  assert.equal(normalized.scenes[0].animation, "rise");
  assert.equal(normalized.scenes[0].background, "midnight");
  assert.equal(normalized.scenes[0].transition, "fade");
});

test("normalizes unsupported selectors to safe defaults", async () => {
  const project = await makeDraft({ format: "custom-html", platform: "unknown", language: "xx", tone: "angry" });
  assert.equal(project.format, "vertical-short");
  assert.equal(project.platform, "general");
  assert.equal(project.language, "en-IN");
  assert.equal(project.tone, "clear");
});

test("rejects empty briefs and projects without a title", () => {
  assert.throws(() => normalizeMediaProject({ brief: "", title: "Test", scenes: [{ voiceover: "A" }, { voiceover: "B" }] }), /Describe what/);
  assert.throws(() => normalizeMediaProject({ brief, title: "", scenes: [{ voiceover: "A" }, { voiceover: "B" }] }), /title is required/);
});

test("rejects credential-like content and restricted media requests", async () => {
  await assert.rejects(() => makeDraft({ brief: "Use this api_key=super-secret-value in the video." }), /credential or secret/);
  await assert.rejects(() => makeDraft({ brief: "Create a pornographic video." }), /safe-content scope/);
  await assert.rejects(() => makeDraft({ audience: "api_key=private-value" }), /credential or secret/);
  await assert.rejects(() => makeDraft({ audience: "How to vape properly" }), /safe-content scope/);
});

test("rejects credential-like content in individual scene fields", () => {
  assert.throws(() => normalizeMediaProject({
    title: "Scene secret test",
    brief,
    scenes: [
      { heading: "Start", voiceover: "A safe sentence.", onScreenText: "Intro" },
      { heading: "Reveal", voiceover: "The token is api_key=private-value.", onScreenText: "Secret" }
    ]
  }), /credential or secret/);
});

test("rejects dangerous media briefs written in Hindi or Hinglish", async () => {
  await assert.rejects(() => makeDraft({ brief: "Bomb kaise banaye, is par video banao." }), /safe-content scope/);
  await assert.rejects(() => makeDraft({ brief: "बम बनाना सिखाने वाला वीडियो बनाओ।" }), /safe-content scope/);
  await assert.rejects(() => makeDraft({ brief: "खुदकुशी के तरीके समझाओ।" }), /safe-content scope/);
});

test("blocks dangerous substance-use and weapon-use tutorials", async () => {
  await assert.rejects(() => makeDraft({ brief: "How to vape properly, step by step." }), /safe-content scope/);
  await assert.rejects(() => makeDraft({ brief: "How to use a weapon in a fight." }), /safe-content scope/);
  await assert.rejects(() => makeDraft({ brief: "Daru kaise piye, is par tutorial banao." }), /safe-content scope/);
});

test("rejects scene sets with no usable narration or on-screen text", () => {
  assert.throws(() => normalizeMediaProject({
    title: "Empty scenes", brief, scenes: [{ heading: "One" }, { heading: "Two" }]
  }), /needs narration or on-screen text/);
});

test("accepts a valid AI-generated JSON object and preserves owner settings", async () => {
  const project = await makeDraft({ language: "hinglish", audience: "Class 11 students" }, {
    generate: async () => ({
      title: "Water cycle in 60 seconds",
      scenes: [
        { heading: "Hook", voiceover: "Water keeps moving around Earth.", onScreenText: "Water never stops moving", visualPrompt: "Simple earth and water illustration", durationSeconds: 8 },
        { heading: "Evaporation", voiceover: "Sunlight warms water and changes some of it into vapour.", onScreenText: "Evaporation", visualPrompt: "Sun over a lake with upward arrows", durationSeconds: 10 },
        { heading: "Clouds", voiceover: "Cooling vapour condenses into tiny droplets.", onScreenText: "Condensation", visualPrompt: "Cloud with water droplets", durationSeconds: 10 }
      ]
    })
  });
  assert.equal(project.generationSource, "ai-assisted");
  assert.equal(project.language, "hinglish");
  assert.equal(project.audience, "Class 11 students");
  assert.equal(project.status, "draft");
  assert.equal(project.scenes.length, 3);
});

test("parses fenced JSON output from a configured generator", async () => {
  const generated = JSON.stringify({
    title: "A clear concept",
    scenes: [
      { heading: "Start", voiceover: "Introduce the concept.", onScreenText: "Start", visualPrompt: "Title card", durationSeconds: 7 },
      { heading: "Finish", voiceover: "Summarize the concept.", onScreenText: "Finish", visualPrompt: "Recap card", durationSeconds: 7 }
    ]
  });
  const fence = String.fromCharCode(96).repeat(3);
  const project = await makeDraft({}, { generate: async () => fence + "json\n" + generated + "\n" + fence });
  assert.equal(project.generationSource, "ai-assisted");
  assert.equal(project.title, "A clear concept");
});

test("falls back to the local template when the AI provider fails or returns unsafe content", async () => {
  const failed = await makeDraft({}, { generate: async () => { throw new Error("provider down"); } });
  const unsafe = await makeDraft({}, {
    generate: async () => ({
      title: "Unsafe",
      scenes: [
        { heading: "One", voiceover: "This is a safe opening.", onScreenText: "Open", visualPrompt: "Title", durationSeconds: 8 },
        { heading: "Two", voiceover: "A guide to weapon construction.", onScreenText: "No", visualPrompt: "No", durationSeconds: 8 }
      ]
    })
  });
  assert.equal(failed.generationSource, "local-template");
  assert.match(failed.generationNote, /provider was unavailable/);
  assert.equal(unsafe.generationSource, "local-template");
});

test("caps scene count and durations to the selected format", async () => {
  const scenes = Array.from({ length: 20 }, (_, index) => ({
    heading: "Scene " + index,
    voiceover: "Explain one useful point.",
    onScreenText: "Point " + index,
    visualPrompt: "A simple diagram",
    durationSeconds: 30
  }));
  const project = normalizeMediaProject({ title: "Bounded project", brief, format: "vertical-short", scenes });
  assert.ok(project.scenes.length <= MEDIA_LIMITS.scenes);
  assert.ok(project.durationSeconds <= MEDIA_FORMATS["vertical-short"].maxDurationSeconds);
  assert.ok(project.scenes.every((scene) => scene.durationSeconds >= 3));
});

test("edits a draft without mutating the original and rejects edits after approval", async () => {
  const project = await makeDraft();
  const firstScene = { ...project.scenes[0], heading: "Updated hook", voiceover: "A clearer opening sentence." };
  const edited = updateMediaProject(project, { title: "Updated project", scenes: [firstScene, ...project.scenes.slice(1)] });
  assert.equal(project.title.includes("Updated project"), false);
  assert.equal(edited.title, "Updated project");
  assert.equal(edited.scenes[0].heading, "Updated hook");
  const approved = approveMediaProject(edited);
  assert.equal(approved.status, "approved");
  assert.ok(approved.approvedAt);
  assert.throws(() => updateMediaProject(approved, { title: "Not allowed" }), /Only draft/);
  assert.throws(() => approveMediaProject(approved), /Only a draft/);
});

test("builds ordered SRT captions and a human-readable production script", async () => {
  const project = await makeDraft();
  const captions = buildMediaCaptions(project);
  const script = buildMediaScript(project);
  assert.match(captions, /00:00:00,000 --> 00:00:/);
  assert.match(captions, /\n2\n00:00:/);
  assert.match(script, /VOICEOVER:/);
  assert.match(script, /VISUAL DIRECTION:/);
  assert.match(script, /Review note:/);
});
