const MAX_FIELD_LENGTH = 1200;

function cleanText(value, limit = MAX_FIELD_LENGTH) {
  return String(value ?? "").trim().slice(0, limit);
}

export function analyzeMediaProject(project) {
  const scenes = Array.isArray(project?.scenes) ? project.scenes : [];
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  const findings = [];
  const add = (level, title, detail, sceneIndex = null) => findings.push({ level, title, detail, sceneIndex });

  if (!cleanText(project?.title, 90)) add("warning", "Project title is missing", "Add a clear title before export.");
  if (scenes.length < 2) add("warning", "Not enough scenes", "A storyboard needs at least two scenes.");
  if (scenes.length > 0 && cleanText(scenes[0]?.voiceover, 600).length < 35) {
    add("tip", "Strengthen the opening hook", "Give the first scene a clear question, promise or visual payoff.", 0);
  }

  scenes.forEach((scene, index) => {
    const heading = cleanText(scene?.heading, 120);
    const voiceover = cleanText(scene?.voiceover, 900);
    const onScreenText = cleanText(scene?.onScreenText, 240);
    const duration = Math.max(0, Number(scene?.durationSeconds) || 0);
    if (!heading) add("warning", "Scene " + (index + 1) + " has no heading", "Add a short label so the storyboard is easy to scan.", index);
    if (!voiceover) add("warning", "Scene " + (index + 1) + " has no narration", "Add voiceover text or intentionally mark this scene as silent.", index);
    if (!onScreenText) add("tip", "Scene " + (index + 1) + " has no on-screen text", "Consider a concise caption or key phrase.", index);
    const shortFormat = ["vertical-short", "square-carousel"].includes(project?.format);
    if (duration > (shortFormat ? 16 : 35)) {
      add("tip", "Scene " + (index + 1) + " may feel slow", "Review its " + duration.toFixed(1) + " second duration and consider a tighter beat.", index);
    }
  });

  const mainTrack = tracks.find((track) => track?.id === "track-main-video");
  const sceneClipCount = mainTrack?.clips?.filter((clip) => clip?.sceneId).length || 0;
  if (scenes.length && mainTrack && sceneClipCount < scenes.length) {
    add("warning", "Some scenes are not on the main timeline", "Check scene-to-timeline alignment before exporting.");
  }
  const audioClips = tracks.filter((track) => track?.kind === "audio")
    .reduce((sum, track) => sum + (Array.isArray(track.clips) ? track.clips.length : 0), 0);
  if (!audioClips) add("tip", "No timeline audio track", "Add voiceover or music when the project needs it. Silent exports are still valid.");

  const warningCount = findings.filter((item) => item.level === "warning").length;
  const tipCount = findings.filter((item) => item.level === "tip").length;
  const score = Math.max(0, 100 - warningCount * 14 - tipCount * 6);
  return {
    score,
    label: score >= 85 ? "Strong draft" : score >= 65 ? "Needs a review" : "Needs attention",
    findings,
    stats: {
      scenes: scenes.length,
      tracks: tracks.length,
      durationSeconds: Math.max(0, Number(project?.durationSeconds) || 0),
      audioClips
    }
  };
}

export function buildMediaCopilotPrompt({ project, scene = null, question = "", mode = "ask" }) {
  const context = {
    title: cleanText(project?.title, 90),
    format: cleanText(project?.format, 40),
    platform: cleanText(project?.platform, 40),
    language: cleanText(project?.language, 30),
    tone: cleanText(project?.tone, 30),
    durationSeconds: Math.max(0, Number(project?.durationSeconds) || 0),
    sceneCount: Array.isArray(project?.scenes) ? project.scenes.length : 0,
    selectedScene: scene ? {
      heading: cleanText(scene.heading, 120),
      voiceover: cleanText(scene.voiceover, 900),
      onScreenText: cleanText(scene.onScreenText, 240),
      visualPrompt: cleanText(scene.visualPrompt, 500),
      durationSeconds: Math.max(0, Number(scene.durationSeconds) || 0)
    } : null
  };
  const languageRule = /^(hi-IN|hinglish)$/i.test(context.language)
    ? "Write natural Hinglish (Hindi-English mix), unless the user explicitly asks otherwise."
    : "Use the project's language and keep the wording accessible.";
  if (mode === "rewrite") {
    return [
      "You are JARVIS, a careful video-editing copilot. Improve only the selected storyboard scene.",
      languageRule,
      "Preserve the user's meaning and any factual claims; do not invent statistics, sources or events.",
      "Fit the voiceover to the scene duration and make on-screen text brief and readable.",
      "Return ONLY one valid JSON object with string keys heading, voiceover, onScreenText, visualPrompt. No markdown fences or commentary.",
      "Project context: " + JSON.stringify(context),
      "Create a stronger, concise version of this scene. Keep its intended message intact."
    ].join("\n");
  }
  return [
    "You are JARVIS, the context-aware copilot inside a video editor.",
    languageRule,
    "Give practical editing advice grounded in the project context below. Do not claim to inspect the underlying media file: only text metadata is provided.",
    "Do not change the project, export, upload, publish or trigger external actions. Suggest changes for the user to review.",
    "Project context: " + JSON.stringify(context),
    "User request: " + cleanText(question, 800)
  ].join("\n");
}

export function parseMediaSceneRewrite(answer, fallback = {}) {
  const source = cleanText(answer, 9000);
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(source.slice(start, end + 1)); }
  catch { return null; }
  const result = {};
  for (const key of ["heading", "voiceover", "onScreenText", "visualPrompt"]) {
    const value = parsed?.[key];
    result[key] = typeof value === "string"
      ? cleanText(value, key === "voiceover" ? 1800 : 600)
      : cleanText(fallback?.[key], key === "voiceover" ? 1800 : 600);
  }
  if (!result.heading || !result.voiceover || !result.onScreenText || !result.visualPrompt) return null;
  return result;
}
