const MAX_FIELD_LENGTH = 1200;
const EDIT_TRANSITIONS = new Set(["cut", "fade", "slide", "wipe", "zoom"]);

function cleanText(value, limit = MAX_FIELD_LENGTH) {
  return String(value ?? "").trim().slice(0, limit);
}

export function applyMediaEditOperations(project, operations) {
  const next = structuredClone(project);
  const scenes = new Map((next.scenes || []).map((scene) => [scene.id, scene]));
  const clips = new Map((next.tracks || []).flatMap((track) => (track.clips || []).map((clip) => [clip.id, { track, clip }])));
  const changed = new Set();
  for (const operation of operations || []) {
    if (!operation || typeof operation !== "object") throw new Error("The edit plan contains an invalid operation.");
    if (operation.type === "rewrite_scene") {
      const scene = scenes.get(operation.sceneId);
      if (!scene) throw new Error("A scene in the plan no longer exists.");
      scene.heading = cleanText(operation.heading, 120);
      scene.voiceover = cleanText(operation.voiceover, 1800);
      scene.onScreenText = cleanText(operation.onScreenText, 600);
      scene.visualPrompt = cleanText(operation.visualPrompt, 600);
      if (!scene.heading || !scene.voiceover || !scene.onScreenText || !scene.visualPrompt) throw new Error("A scene rewrite has an empty required field.");
      changed.add("scene:" + scene.id);
    } else if (operation.type === "set_scene_transition") {
      const scene = scenes.get(operation.sceneId);
      if (!scene || !EDIT_TRANSITIONS.has(operation.transition)) throw new Error("A transition in the plan is invalid.");
      scene.transition = operation.transition;
      changed.add("transition:" + scene.id);
    } else if (operation.type === "set_clip_volume") {
      const target = clips.get(operation.clipId);
      if (!target || target.track.kind !== "audio" || !Number.isFinite(operation.volume) || operation.volume < 0 || operation.volume > 1.5) throw new Error("An audio adjustment in the plan is invalid.");
      target.clip.volume = operation.volume;
      changed.add("volume:" + operation.clipId);
    } else if (operation.type === "set_track_muted") {
      const track = (next.tracks || []).find((item) => item.id === operation.trackId && item.kind === "audio");
      if (!track || typeof operation.muted !== "boolean") throw new Error("An audio track change in the plan is invalid.");
      track.muted = operation.muted;
      changed.add("muted:" + operation.trackId);
    } else if (operation.type === "move_clip") {
      const target = clips.get(operation.clipId);
      if (!target || !Number.isFinite(operation.start) || operation.start < 0 || operation.start + target.clip.duration > (Number(next.durationSeconds) || 1200)) throw new Error("A timeline move in the plan is outside the project.");
      target.clip.start = operation.start;
      changed.add("move:" + operation.clipId);
    } else if (operation.type === "trim_clip") {
      const target = clips.get(operation.clipId);
      if (!target || target.clip.sceneId || !["video", "audio"].includes(target.clip.assetType) || !Number.isFinite(operation.sourceIn) || !Number.isFinite(operation.sourceOut) || operation.sourceIn < 0 || operation.sourceOut <= operation.sourceIn) throw new Error("A trim in the plan is invalid.");
      const clip = target.clip;
      const speeds = Array.isArray(clip.speedRamp) ? clip.speedRamp.map((point) => Number(point.speed)).filter(Number.isFinite) : [];
      const speed = Math.max(0.25, Math.min(4, Number(clip.speed) || 1));
      if (speeds.some((value) => Math.abs(value - speed) > 0.001)) throw new Error("This clip has a speed ramp; edit its trim manually to preserve timing.");
      const oldIn = Math.max(0, Number(clip.sourceIn) || 0);
      const oldOut = Number(clip.sourceOut);
      if (!Number.isFinite(oldOut) || operation.sourceIn < oldIn || operation.sourceOut > oldOut) throw new Error("A trim must stay inside the clip's current source range.");
      clip.sourceIn = operation.sourceIn;
      clip.sourceOut = operation.sourceOut;
      clip.duration = (operation.sourceOut - operation.sourceIn) / speed;
      clip.speedRamp = [];
      changed.add("trim:" + operation.clipId);
    } else {
      throw new Error("The edit plan contains an unsupported operation.");
    }
  }
  for (const operation of operations || []) {
    if (operation.type !== "move_clip" && operation.type !== "trim_clip") continue;
    const target = clips.get(operation.clipId);
    const start = Number(target.clip.start) || 0;
    const end = start + (Number(target.clip.duration) || 0);
    for (const peer of target.track.clips) {
      if (peer.id === target.clip.id) continue;
      const peerStart = Number(peer.start) || 0;
      const peerEnd = peerStart + (Number(peer.duration) || 0);
      if (start < peerEnd - 0.02 && end > peerStart + 0.02) throw new Error("The plan would create overlapping clips on the same track. No edits were applied.");
    }
  }
  if (changed.size !== (operations || []).length) throw new Error("The plan repeats a conflicting edit. Review it again before applying.");
  next.durationSeconds = Math.max(0, ...next.tracks.flatMap((track) => (track.clips || []).map((clip) => clip.start + clip.duration)));
  return next;
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
    const visualPrompt = cleanText(scene?.visualPrompt, 500);
    if (!visualPrompt) {
      add("warning", "Scene " + (index + 1) + " has no visual direction", "Describe a specific subject, action and focal point that directly supports the narration.", index);
    }
    const longForm = project?.format === "long-form";
    const pacingLimit = longForm ? 8 : (shortFormat ? 16 : 35);
    if (duration > pacingLimit) {
      add("tip", "Scene " + (index + 1) + " may need more visual beats", longForm
        ? "This narration beat lasts " + duration.toFixed(1) + " seconds. Consider splitting it into shorter, narration-synchronised shots or cutaways."
        : "Review its " + duration.toFixed(1) + " second duration and consider a tighter beat.", index);
    }
  });

  const mainTrack = tracks.find((track) => track?.id === "track-main-video");
  const mainSceneClips = Array.isArray(mainTrack?.clips)
    ? mainTrack.clips.filter((clip) => clip?.sceneId && clip.visible !== false).slice().sort((a, b) =>
      (Number(a.start) || 0) - (Number(b.start) || 0)
    )
    : [];
  const mappedSceneIds = new Set(mainSceneClips.map((clip) => clip.sceneId));
  const missingSceneCount = scenes.filter((scene) => scene?.id && !mappedSceneIds.has(scene.id)).length;
  if (scenes.length && mainTrack && missingSceneCount > 0) {
    add("warning", missingSceneCount + (missingSceneCount === 1 ? " scene is" : " scenes are") + " missing from the main timeline",
      "A storyboard scene without a visible timeline clip will not appear in the rendered video.");
  }

  const duplicateClipIds = new Set();
  const seenClipIds = new Set();
  for (const track of tracks) {
    for (const clip of Array.isArray(track?.clips) ? track.clips : []) {
      const id = cleanText(clip?.id, 100);
      if (!id) continue;
      if (seenClipIds.has(id)) duplicateClipIds.add(id);
      seenClipIds.add(id);
    }
  }
  if (duplicateClipIds.size) {
    add("warning", "Timeline clips share an identifier", duplicateClipIds.size + " clip ID(s) are repeated. Reopen or repair the affected timeline items before export.");
  }

  let timelineGapCount = 0;
  let timelineOverlapCount = 0;
  if (mainTrack && mainTrack.visible !== false && mainSceneClips.length) {
    const toleranceSeconds = 0.08;
    let coveredUntil = 0;
    for (const clip of mainSceneClips) {
      const start = Math.max(0, Number(clip.start) || 0);
      const end = start + Math.max(0, Number(clip.duration) || 0);
      if (start - coveredUntil > toleranceSeconds) timelineGapCount++;
      if (coveredUntil - start > toleranceSeconds) timelineOverlapCount++;
      coveredUntil = Math.max(coveredUntil, end);
    }
    const projectDuration = Math.max(0, Number(project?.durationSeconds) || 0);
    if (projectDuration - coveredUntil > toleranceSeconds) timelineGapCount++;
    if (timelineGapCount) {
      add("warning", "The main timeline contains a visual gap", timelineGapCount + " uncovered section(s) may render as a blank frame. Review the playhead at each gap before export.");
    }
    if (timelineOverlapCount) {
      add("warning", "Main timeline scene clips overlap", timelineOverlapCount + " overlap(s) can hide a scene because the preview and export select the first matching clip.");
    }
  }

  const activeCaptionCues = project?.captionsEnabled === true && Array.isArray(project?.captionCues)
    ? project.captionCues.filter((cue) => cue && Number.isFinite(Number(cue.startSeconds)) && Number.isFinite(Number(cue.endSeconds)))
      .slice().sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))
    : [];
  let captionOverlapCount = 0;
  let captionCoverageEnd = -Infinity;
  for (const cue of activeCaptionCues) {
    const start = Number(cue.startSeconds);
    const end = Number(cue.endSeconds);
    if (start < captionCoverageEnd - 0.02) captionOverlapCount++;
    captionCoverageEnd = Math.max(captionCoverageEnd, end);
  }
  if (captionOverlapCount) {
    add("warning", "Timed captions overlap", captionOverlapCount + " cue overlap(s) can hide earlier caption text because the preview displays one cue at a time.");
  }
  const audioClips = tracks.filter((track) => track?.kind === "audio")
    .reduce((sum, track) => sum + (Array.isArray(track.clips) ? track.clips.length : 0), 0);
  if (!audioClips) add("tip", "No timeline audio track", "Add voiceover or music when the project needs it. Silent exports are still valid.");

  // Compare only adjacent scenes: repeated visual direction is most noticeable at a cut.
  const visualTokens = (value) => new Set(
    cleanText(value, 500).toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/u)
      .filter((token) => token.length > 2)
  );
  for (let index = 1; index < scenes.length; index++) {
    const previous = visualTokens(scenes[index - 1]?.visualPrompt);
    const current = visualTokens(scenes[index]?.visualPrompt);
    if (previous.size < 3 || current.size < 3) continue;
    let shared = 0;
    for (const token of current) if (previous.has(token)) shared++;
    const similarity = shared / Math.max(1, previous.size + current.size - shared);
    if (similarity >= 0.72) {
      add("warning", "Scenes " + index + " and " + (index + 1) + " may repeat the same visual",
        "Change the focal subject, shot scale, action or visual explanation so the next cut adds new information.", index);
    }
  }

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
      audioClips,
      missingSceneCount,
      timelineGapCount,
      timelineOverlapCount,
      captionOverlapCount,
      duplicateClipIdCount: duplicateClipIds.size
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
