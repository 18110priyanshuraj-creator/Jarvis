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
  normalizeTimelineTracks,
  sampleTimelineKeyframes,
  sampleTimelineSpeed,
  integrateTimelineSpeed,
  splitTimelineClip,
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

test("normalizes multi-track clips, chroma key, custom keyframes and speed ramps", () => {
  const tracks = normalizeTimelineTracks([
    {
      id: "video-main",
      name: "Main video",
      kind: "video",
      clips: [{
        id: "clip-a",
        assetId: "asset-a",
        assetName: "scene.mp4",
        assetType: "video",
        start: 1,
        duration: 6,
        sourceIn: 2,
        sourceOut: 8,
        speed: 1,
        keyframes: [
          { time: 0, x: 0, y: 0, scale: 1, opacity: 1, easing: "cubic-bezier", curve: { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } },
          { time: 6, x: 0.5, y: -0.2, scale: 1.6, opacity: 0.8, rotation: 12 }
        ],
        speedRamp: [{ time: 0, speed: 1 }, { time: 6, speed: 3 }],
        chromaKey: { enabled: true, color: "#00ff00", similarity: 0.4, softness: 0.2 }
      }]
    },
    { id: "overlay-1", kind: "overlay", clips: [{ id: "logo", assetType: "image", duration: 4 }] }
  ]);
  assert.equal(tracks.length, 2);
  assert.equal(tracks[0].clips[0].chromaKey.enabled, true);
  assert.equal(tracks[0].clips[0].keyframes.length, 2);
  assert.equal(tracks[0].clips[0].speedRamp.length, 2);
  assert.ok(Math.abs(sampleTimelineSpeed(tracks[0].clips[0], 3) - 2) < 0.001);
  const midpoint = sampleTimelineKeyframes(tracks[0].clips[0], 3);
  assert.ok(midpoint.x > 0 && midpoint.scale > 1);
  assert.ok(integrateTimelineSpeed(tracks[0].clips[0], 0, 6) > 6);
  const [first, second] = splitTimelineClip(tracks[0].clips[0], 3);
  assert.equal(first.duration, 3);
  assert.equal(second.duration, 3);
  assert.equal(second.start, 4);
  assert.ok(second.sourceIn > first.sourceIn);
});

test("explicit timeline tracks determine the saved project duration", () => {
  const project = normalizeMediaProject({
    title: "Timeline extent",
    brief,
    scenes: [
      { id: "scene-a", heading: "A", voiceover: "First scene.", durationSeconds: 8 },
      { id: "scene-b", heading: "B", voiceover: "Second scene.", durationSeconds: 8 }
    ],
    tracks: [
      {
        id: "track-main-video",
        kind: "video",
        clips: [{ id: "base-a", sceneId: "scene-a", assetType: "scene", start: 4, duration: 3 }]
      },
      {
        id: "audio-lane",
        kind: "audio",
        clips: [{ id: "sound", assetType: "audio", start: 10, duration: 5 }]
      }
    ]
  });
  assert.equal(project.durationSeconds, 15);
  assert.equal(project.tracks[0].clips[0].start, 4);
  assert.equal(project.tracks[0].clips[0].duration, 3);

  const emptyTimeline = normalizeMediaProject({
    title: "Empty timeline",
    brief,
    scenes: [
      { id: "scene-c", heading: "C", voiceover: "First scene.", durationSeconds: 8 },
      { id: "scene-d", heading: "D", voiceover: "Second scene.", durationSeconds: 8 }
    ],
    tracks: [{ id: "track-main-video", kind: "video", clips: [] }]
  });
  assert.equal(emptyTimeline.durationSeconds, 0);
});

test("normalizes clip masks to supported shapes and bounded geometry", () => {
  const tracks = normalizeTimelineTracks([{
    id: "masked-video",
    kind: "overlay",
    clips: [{
      id: "masked-clip",
      duration: 8,
      mask: { shape: "ellipse", x: 0.2, y: -0.1, width: 0.8, height: 0.6, feather: 0.15, invert: true }
    }]
  }]);
  assert.deepEqual(tracks[0].clips[0].mask, {
    shape: "ellipse", x: 0.2, y: -0.1, width: 0.8, height: 0.6, feather: 0.15, invert: true
  });
  const invalid = normalizeTimelineTracks([{
    kind: "overlay",
    clips: [{ duration: 8, mask: { shape: "freehand-js", x: 9, y: -9, width: 5, height: 0, feather: 2 } }]
  }])[0].clips[0].mask;
  assert.equal(invalid.shape, "none");
  assert.deepEqual([invalid.x, invalid.y, invalid.width, invalid.height, invalid.feather], [1, -1, 2, 0.05, 0.5]);
});

test("bounds excessive timeline counts and clamps invalid speed/key values", () => {
  const tracks = normalizeTimelineTracks(Array.from({ length: 20 }, (_, index) => ({
    id: "track-" + index,
    kind: "video",
    clips: Array.from({ length: 80 }, (_, clipIndex) => ({
      id: "clip-" + index + "-" + clipIndex,
      duration: 999,
      start: 999,
      speed: 99,
      chromaKey: { enabled: true, color: "javascript:alert(1)", similarity: 3, softness: -2 },
      keyframes: [{ time: 999, x: 99, y: -99, scale: 90, opacity: 5, rotation: 999 }]
    }))
  })));
  assert.equal(tracks.length, 8);
  assert.equal(tracks[0].clips.length, 48);
  assert.equal(tracks[0].clips[0].duration, 180);
  assert.equal(tracks[0].clips[0].start, 0);
  assert.equal(tracks[0].clips[0].speed, 4);
  assert.equal(tracks[0].clips[0].chromaKey.color, "#00ff00");
  assert.equal(tracks[0].clips[0].chromaKey.similarity, 1);
  assert.equal(tracks[0].clips[0].chromaKey.softness, 0);
});

test("supports validated camera movements and bounded per-scene colour grading", () => {
  const project = normalizeMediaProject({
    title: "Advanced camera and colour test",
    brief,
    scenes: [
      {
        heading: "Push in",
        voiceover: "A clear opening.",
        cameraMotion: "ken-burns",
        grade: { brightness: 128, contrast: 115, saturation: 145, blur: 2.5 }
      },
      {
        heading: "Fallback and bounds",
        voiceover: "A clear ending.",
        cameraMotion: "run-script",
        grade: { brightness: 300, contrast: -20, saturation: 250, blur: 90 }
      }
    ]
  });
  assert.equal(project.scenes[0].cameraMotion, "ken-burns");
  assert.deepEqual(project.scenes[0].grade, { brightness: 128, contrast: 115, saturation: 145, blur: 2.5 });
  assert.equal(project.scenes[1].cameraMotion, "static");
  assert.deepEqual(project.scenes[1].grade, { brightness: 150, contrast: 50, saturation: 180, blur: 12 });
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
        { heading: "Hook", voiceover: "Water keeps moving around Earth.", onScreenText: "Water never stops moving", visualPrompt: "Simple earth and water illustration", cameraMotion: "push-in", grade: { brightness: 106, contrast: 112, saturation: 108, blur: 0 }, durationSeconds: 8 },
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
  assert.equal(project.scenes[0].cameraMotion, "push-in");
  assert.deepEqual(project.scenes[0].grade, { brightness: 106, contrast: 112, saturation: 108, blur: 0 });
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


test("supports 20-minute long-form landscape projects with bounded scenes and timeline clips", () => {
  const scenes = Array.from({ length: 20 }, (_, index) => ({
    heading: "Chapter " + (index + 1),
    voiceover: "Explain one complete chapter of the topic with a clear example and summary.",
    onScreenText: "Chapter " + (index + 1),
    visualPrompt: "A focused educational illustration.",
    durationSeconds: 120
  }));
  const project = normalizeMediaProject({
    title: "Long-form lesson",
    brief,
    format: "long-form",
    platform: "youtube",
    scenes
  });

  assert.equal(project.format, "long-form");
  assert.deepEqual([project.width, project.height], [1280, 720]);
  assert.equal(MEDIA_FORMATS["long-form"].maxDurationSeconds, 1200);
  assert.equal(MEDIA_LIMITS.maxDurationSeconds, 1200);
  assert.equal(project.scenes.length, 20);
  assert.ok(project.scenes.every((scene) => scene.durationSeconds === 60));
  assert.equal(project.durationSeconds, 1200);

  const boundedTimeline = normalizeMediaProject({
    title: "Long timeline",
    brief,
    format: "long-form",
    scenes: scenes.slice(0, 2),
    tracks: [{
      id: "track-main-video",
      kind: "video",
      clips: [{ id: "long-clip", start: 1170, duration: 90, assetType: "video" }]
    }]
  });
  assert.equal(boundedTimeline.tracks[0].clips[0].duration, 90);
  assert.equal(boundedTimeline.tracks[0].clips[0].start, 1110);
  assert.equal(boundedTimeline.durationSeconds, 1200);
});

test("keeps standard landscape projects capped at three minutes", () => {
  const scenes = Array.from({ length: 10 }, (_, index) => ({
    heading: "Scene " + index,
    voiceover: "A clear explanation for this scene.",
    onScreenText: "Point " + index,
    durationSeconds: 30
  }));
  const project = normalizeMediaProject({
    title: "Standard landscape",
    brief,
    format: "landscape-explainer",
    scenes
  });
  assert.equal(MEDIA_FORMATS["landscape-explainer"].maxDurationSeconds, 180);
  assert.equal(project.durationSeconds, 180);
  assert.ok(project.scenes.every((scene) => scene.durationSeconds <= 18));
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
