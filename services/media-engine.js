import crypto from "node:crypto";

const MAX_BRIEF = 1800;
const MAX_TITLE = 90;
const MAX_SCENES = 80;
const MAX_PROJECT_DURATION_SECONDS = 20 * 60;
const MIN_SCENES = 2;
const MAX_SCENE_TEXT = 900;
const MAX_VISUAL_PROMPT = 360;
const MAX_TIMELINE_TRACKS = 8;
const MAX_TIMELINE_CLIPS = 160;
const MAX_KEYFRAMES = 16;
const MAX_SPEED_POINTS = 8;
const TIMELINE_TRACK_KINDS = new Set(["video", "overlay", "audio"]);
const TIMELINE_EASINGS = new Set(["linear", "ease-in", "ease-out", "ease-in-out", "hold", "cubic-bezier"]);
const TIMELINE_ASSET_TYPES = new Set(["scene", "image", "video", "audio"]);

const FORMATS = Object.freeze({
  "vertical-short": Object.freeze({ label: "Vertical short", width: 720, height: 1280, maxDurationSeconds: 90, maxSceneDurationSeconds: 30 }),
  "landscape-explainer": Object.freeze({ label: "Landscape explainer", width: 1280, height: 720, maxDurationSeconds: 180, maxSceneDurationSeconds: 30 }),
  "long-form": Object.freeze({ label: "Long-form video (up to 20 minutes)", width: 1280, height: 720, maxDurationSeconds: MAX_PROJECT_DURATION_SECONDS, maxSceneDurationSeconds: 120 }),
  "square-carousel": Object.freeze({ label: "Square carousel", width: 1080, height: 1080, maxDurationSeconds: 60, maxSceneDurationSeconds: 5 })
});
const PLATFORMS = new Set(["youtube-shorts", "youtube", "instagram-reels", "instagram-carousel", "tiktok", "general"]);
const LANGUAGES = new Set(["en-IN", "hi-IN", "hinglish"]);
const TONES = new Set(["clear", "friendly", "energetic", "calm", "documentary", "professional"]);
const PROJECT_STATES = new Set(["draft", "approved"]);
const VISUAL_STYLES = new Set(["cinematic-motion", "stick-figure-story", "minimal-editorial"]);
const SCENE_VISUAL_TYPES = new Set(["auto", "stick-figure", "diagram", "quote", "title-card"]);
const FIGURE_POSES = new Set(["idle", "walk", "point", "think", "celebrate"]);
const SCENE_ANIMATIONS = new Set(["fade", "rise", "bounce", "walk", "gesture"]);
const SCENE_BACKGROUNDS = new Set(["midnight", "sunset", "paper", "mint", "violet"]);
const SCENE_TRANSITIONS = new Set(["cut", "fade", "slide", "wipe", "zoom"]);
const SCENE_CAMERA_MOTIONS = new Set(["static", "ken-burns", "push-in", "pull-out", "pan-left", "pan-right", "drift-up"]);
const SECRET_PATTERN = /(?:\b|_)(?:api[_ -]?key|access[_ -]?token|password|passcode|one[- ]time code|otp|private key)\b\s*[:=]\s*\S+/i;
const TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/i;
const RESTRICTED_MEDIA_PATTERN = /(?:\b(?:porn(?:ography|ographic)?|erotic|masturbat(?:e|ion)|explicit sexual|nude|suicid(?:e|al)|self[- ]harm|cutting tutorial|weapon construction|build (?:a )?(?:bomb|gun|weapon|knife|sword|taser)|make (?:a )?(?:bomb|explosive|weapon|gun)|explosive device|drug synthesis|how to (?:hide|use) (?:drugs|a weapon)|how to vape\b|how to (?:use|refill) (?:a )?(?:vape|e-cigarette)|how to (?:smoke|vape|drink|take|use|dose) (?:weed|marijuana|cannabis|cocaine|meth|heroin|ecstasy|mdma|alcohol|nicotine|tobacco|vapes?)|how to (?:use|carry|fight with) (?:a )?(?:gun|knife|sword|weapon|taser)|vape tricks|nicotine challenge)\b|आत्महत्या|खुदकुशी|खुद\s+को\s+नुकसान|बम\s+बनाना|बंदूक\s+बनाना|हथियार\s+बनाना|विस्फोटक\s+बनाना|ज़हर\s+बनाना|जहर\s+बनाना|शराब\s+(?:कैसे\s+)?(?:पीएं|पिएं)|सिगरेट\s+(?:कैसे\s+)?(?:पीएं|पिएं)|नशा\s+कैसे\s+करें|\b(?:khudkushi|aatmahatya|bomb|bam|bandook|hathiyar|zehar|zahar)\s+(?:kaise|banana|banaye|banane)\b|\b(?:daru|sharab|nasha|ganja|weed|cannabis)\s+(?:kaise|use|piye|peeye|le)\b)/iu;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\u0000/g, "").trim().slice(0, maxLength) : "";
}

function validDate(value, fallback) {
  const parsed = typeof value === "string" ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function boundedDuration(value, fallback = 8, maximum = 30) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(3, Math.round(parsed)));
}
function boundedNumber(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}


function normalizeCurve(value) {
  return {
    x1: boundedNumber(value?.x1, 0.25, 0, 1),
    y1: boundedNumber(value?.y1, 0.1, 0, 1),
    x2: boundedNumber(value?.x2, 0.25, 0, 1),
    y2: boundedNumber(value?.y2, 1, 0, 1)
  };
}

function normalizeEasing(value) {
  return TIMELINE_EASINGS.has(value) ? value : "linear";
}

function normalizeKeyframes(value, durationSeconds) {
  const source = Array.isArray(value) ? value.slice(0, MAX_KEYFRAMES) : [];
  const points = source.map((point) => ({
    time: boundedNumber(point?.time, 0, 0, durationSeconds),
    x: boundedNumber(point?.x, 0, -2, 2),
    y: boundedNumber(point?.y, 0, -2, 2),
    scale: boundedNumber(point?.scale, 1, 0.1, 4),
    opacity: boundedNumber(point?.opacity, 1, 0, 1),
    rotation: boundedNumber(point?.rotation, 0, -360, 360),
    easing: normalizeEasing(point?.easing),
    curve: normalizeCurve(point?.curve)
  })).sort((a, b) => a.time - b.time);
  if (!points.length) {
    return [
      { time: 0, x: 0, y: 0, scale: 1, opacity: 1, rotation: 0, easing: "linear", curve: normalizeCurve() },
      { time: durationSeconds, x: 0, y: 0, scale: 1, opacity: 1, rotation: 0, easing: "linear", curve: normalizeCurve() }
    ];
  }
  if (points[0].time > 0) points.unshift({ ...points[0], time: 0 });
  if (points.at(-1).time < durationSeconds) points.push({ ...points.at(-1), time: durationSeconds });
  return points.slice(0, MAX_KEYFRAMES);
}

function normalizeSpeedRamp(value, durationSeconds, fallbackSpeed = 1) {
  const source = Array.isArray(value) ? value.slice(0, MAX_SPEED_POINTS) : [];
  const points = source.map((point) => ({
    time: boundedNumber(point?.time, 0, 0, durationSeconds),
    speed: boundedNumber(point?.speed, fallbackSpeed, 0.25, 4),
    easing: normalizeEasing(point?.easing),
    curve: normalizeCurve(point?.curve)
  })).sort((a, b) => a.time - b.time);
  if (!points.length) {
    return [
      { time: 0, speed: fallbackSpeed, easing: "linear", curve: normalizeCurve() },
      { time: durationSeconds, speed: fallbackSpeed, easing: "linear", curve: normalizeCurve() }
    ];
  }
  if (points[0].time > 0) points.unshift({ ...points[0], time: 0 });
  if (points.at(-1).time < durationSeconds) points.push({ ...points.at(-1), time: durationSeconds });
  return points.slice(0, MAX_SPEED_POINTS);
}

function normalizeTimelineClip(clip, index, trackKind, maxDurationSeconds = 180) {
  const duration = boundedNumber(clip?.duration, 6, 0.25, maxDurationSeconds);
  const start = boundedNumber(clip?.start, 0, 0, Math.max(0, maxDurationSeconds - duration));
  const speed = boundedNumber(clip?.speed, 1, 0.25, 4);
  const assetType = TIMELINE_ASSET_TYPES.has(clip?.assetType)
    ? clip.assetType
    : trackKind === "audio" ? "audio" : "video";
  const sourceIn = boundedNumber(clip?.sourceIn, 0, 0, 36000);
  const sourceOut = clip?.sourceOut === null || clip?.sourceOut === undefined || clip?.sourceOut === ""
    ? null
    : boundedNumber(clip.sourceOut, sourceIn + duration * speed, sourceIn + 0.05, 36000);
  const key = clip?.chromaKey || {};
  const color = typeof key.color === "string" && /^#[0-9a-f]{6}$/i.test(key.color) ? key.color.toLowerCase() : "#00ff00";
  return {
    id: cleanText(clip?.id, 80) || crypto.randomUUID(),
    sceneId: cleanText(clip?.sceneId, 80) || null,
    assetId: cleanText(clip?.assetId, 100) || null,
    assetName: cleanText(clip?.assetName, 140),
    assetType,
    label: cleanText(clip?.label, 80) || "Clip " + (index + 1),
    start,
    duration,
    sourceIn,
    sourceOut,
    speed,
    volume: boundedNumber(clip?.volume, 1, 0, 1.5),
    fit: clip?.fit === "contain" ? "contain" : "cover",
    transform: {
      x: boundedNumber(clip?.transform?.x, 0, -2, 2),
      y: boundedNumber(clip?.transform?.y, 0, -2, 2),
      scale: boundedNumber(clip?.transform?.scale, 1, 0.1, 4),
      opacity: boundedNumber(clip?.transform?.opacity, 1, 0, 1),
      rotation: boundedNumber(clip?.transform?.rotation, 0, -360, 360)
    },
    keyframes: normalizeKeyframes(clip?.keyframes, duration),
    speedRamp: normalizeSpeedRamp(clip?.speedRamp, duration, speed),
    chromaKey: {
      enabled: key.enabled === true,
      color,
      similarity: boundedNumber(key.similarity, 0.34, 0.01, 1),
      softness: boundedNumber(key.softness, 0.12, 0, 1)
    },
    mask: {
      shape: ["none", "rectangle", "ellipse", "rounded"].includes(clip?.mask?.shape) ? clip.mask.shape : "none",
      x: boundedNumber(clip?.mask?.x, 0, -1, 1),
      y: boundedNumber(clip?.mask?.y, 0, -1, 1),
      width: boundedNumber(clip?.mask?.width, 1, 0.05, 2),
      height: boundedNumber(clip?.mask?.height, 1, 0.05, 2),
      feather: boundedNumber(clip?.mask?.feather, 0, 0, 0.5),
      invert: clip?.mask?.invert === true
    },
    visible: clip?.visible !== false,
    muted: clip?.muted === true
  };
}

export function normalizeTimelineTracks(value, scenes = [], maxDurationSeconds = 180) {
  const source = Array.isArray(value) ? value.slice(0, MAX_TIMELINE_TRACKS) : [];
  const fallback = [{
    id: "track-main-video",
    name: "Main video",
    kind: "video",
    visible: true,
    muted: false,
    clips: scenes.map((scene, index) => ({
      id: "clip-" + scene.id,
      sceneId: scene.id,
      assetType: "scene",
      label: scene.heading || "Scene " + (index + 1),
      start: scenes.slice(0, index).reduce((sum, item) => sum + item.durationSeconds, 0),
      duration: scene.durationSeconds,
      speed: 1
    }))
  }];
  const tracks = (source.length ? source : fallback).map((track, index) => {
    const kind = TIMELINE_TRACK_KINDS.has(track?.kind) ? track.kind : "video";
    const clips = Array.isArray(track?.clips) ? track.clips.slice(0, MAX_TIMELINE_CLIPS) : [];
    return {
      id: cleanText(track?.id, 80) || "track-" + (index + 1),
      name: cleanText(track?.name, 60) || (kind === "video" ? "Video" : kind === "overlay" ? "Overlay" : "Audio") + " " + (index + 1),
      kind,
      visible: track?.visible !== false,
      muted: track?.muted === true,
      clips: clips.map((clip, clipIndex) => normalizeTimelineClip(clip, clipIndex, kind, maxDurationSeconds))
    };
  });
  return tracks;
}

function cubicBezierProgress(t, curve) {
  const { x1, y1, x2, y2 } = normalizeCurve(curve);
  const sample = (a, b, p) => 3 * a * (1 - p) ** 2 * p + 3 * b * (1 - p) * p ** 2 + p ** 3;
  let low = 0;
  let high = 1;
  let parameter = Math.max(0, Math.min(1, t));
  for (let i = 0; i < 12; i++) {
    const x = sample(x1, x2, parameter);
    if (Math.abs(x - t) < 0.0005) break;
    if (x < t) low = parameter;
    else high = parameter;
    parameter = (low + high) / 2;
  }
  return sample(y1, y2, parameter);
}

function easedProgress(t, easing, curve) {
  const bounded = Math.max(0, Math.min(1, t));
  if (easing === "hold") return bounded < 1 ? 0 : 1;
  if (easing === "ease-in") return bounded * bounded;
  if (easing === "ease-out") return 1 - (1 - bounded) ** 2;
  if (easing === "ease-in-out") return bounded < 0.5 ? 2 * bounded * bounded : 1 - ((-2 * bounded + 2) ** 2) / 2;
  if (easing === "cubic-bezier") return cubicBezierProgress(bounded, curve);
  return bounded;
}

export function sampleTimelineKeyframes(clip, timeSeconds) {
  const points = normalizeKeyframes(clip?.keyframes, boundedNumber(clip?.duration, 6, 0.25, MAX_PROJECT_DURATION_SECONDS));
  const time = boundedNumber(timeSeconds, 0, 0, MAX_PROJECT_DURATION_SECONDS);
  let rightIndex = points.findIndex((point) => point.time >= time);
  if (rightIndex <= 0) return { ...points[0] };
  if (rightIndex < 0) return { ...points.at(-1) };
  const left = points[rightIndex - 1];
  const right = points[rightIndex];
  const span = Math.max(0.0001, right.time - left.time);
  const progress = easedProgress((time - left.time) / span, left.easing, left.curve);
  return {
    time,
    x: left.x + (right.x - left.x) * progress,
    y: left.y + (right.y - left.y) * progress,
    scale: left.scale + (right.scale - left.scale) * progress,
    opacity: left.opacity + (right.opacity - left.opacity) * progress,
    rotation: left.rotation + (right.rotation - left.rotation) * progress
  };
}

export function sampleTimelineSpeed(clip, timeSeconds) {
  const points = normalizeSpeedRamp(clip?.speedRamp, boundedNumber(clip?.duration, 6, 0.25, MAX_PROJECT_DURATION_SECONDS), boundedNumber(clip?.speed, 1, 0.25, 4));
  const time = boundedNumber(timeSeconds, 0, 0, MAX_PROJECT_DURATION_SECONDS);
  const rightIndex = points.findIndex((point) => point.time >= time);
  if (rightIndex <= 0) return points[0].speed;
  if (rightIndex < 0) return points.at(-1).speed;
  const left = points[rightIndex - 1];
  const right = points[rightIndex];
  const progress = easedProgress((time - left.time) / Math.max(0.0001, right.time - left.time), left.easing, left.curve);
  return left.speed + (right.speed - left.speed) * progress;
}

export function integrateTimelineSpeed(clip, fromSeconds = 0, toSeconds = Number(clip?.duration || 0)) {
  const from = Math.max(0, Number(fromSeconds) || 0);
  const to = Math.max(from, Math.min(Number(clip?.duration || 0), Number(toSeconds) || 0));
  if (to <= from) return 0;
  const steps = Math.max(8, Math.ceil((to - from) * 20));
  const step = (to - from) / steps;
  let area = 0;
  for (let index = 0; index < steps; index++) {
    const left = sampleTimelineSpeed(clip, from + index * step);
    const right = sampleTimelineSpeed(clip, from + (index + 1) * step);
    area += (left + right) * 0.5 * step;
  }
  return area;
}

export function splitTimelineClip(clip, splitAtSeconds) {
  const splitAt = Number(splitAtSeconds);
  if (!Number.isFinite(splitAt) || splitAt <= 0.25 || splitAt >= Number(clip?.duration) - 0.25) {
    throw new TypeError("Choose a split point at least 0.25 seconds from either clip edge.");
  }
  const firstDuration = splitAt;
  const secondDuration = Number(clip.duration) - splitAt;
  const splitSpeed = sampleTimelineSpeed(clip, splitAt);
  const splitSource = Number(clip.sourceIn || 0) + integrateTimelineSpeed(clip, 0, splitAt);
  const first = {
    ...clip,
    duration: firstDuration,
    sourceOut: splitSource,
    keyframes: normalizeKeyframes(clip.keyframes, clip.duration)
      .filter((point) => point.time <= splitAt)
      .map((point) => ({ ...point, time: Math.min(point.time, firstDuration) })),
    speedRamp: normalizeSpeedRamp(clip.speedRamp, clip.duration, clip.speed)
      .filter((point) => point.time <= splitAt)
      .map((point) => ({ ...point, time: Math.min(point.time, firstDuration) }))
  };
  const second = {
    ...clip,
    id: crypto.randomUUID(),
    label: (clip.label || "Clip") + " · B",
    start: Number(clip.start || 0) + splitAt,
    duration: secondDuration,
    sourceIn: splitSource,
    sourceOut: clip.sourceOut,
    keyframes: normalizeKeyframes(clip.keyframes, clip.duration)
      .filter((point) => point.time >= splitAt)
      .map((point) => ({ ...point, time: point.time - splitAt })),
    speedRamp: normalizeSpeedRamp(clip.speedRamp, clip.duration, clip.speed)
      .filter((point) => point.time >= splitAt)
      .map((point) => ({ ...point, time: point.time - splitAt }))
  };
  return [
    normalizeTimelineClip(first, 0, "video", MAX_PROJECT_DURATION_SECONDS),
    normalizeTimelineClip(second, 1, "video", MAX_PROJECT_DURATION_SECONDS)
  ];
}

function formatKey(value) {
  return Object.hasOwn(FORMATS, value) ? value : "vertical-short";
}

function splitBrief(brief) {
  return brief.split(/(?:\n+|(?<=[.!?।])\s+)/u)
    .map((part) => cleanText(part, 450))
    .filter(Boolean)
    .slice(0, 6);
}

function createTemplateScenes(brief, format, visualStyle) {
  const points = splitBrief(brief);
  const topic = cleanText(brief.split(/[.!?\n।]/u)[0], 120) || "The main idea";
  const ideas = points.length ? points : [topic];
  const scenes = [
    {
      heading: "The hook",
      voiceover: "What should you understand about " + topic + "? Let us make the idea clear.",
      onScreenText: topic,
      visualPrompt: "A clean title card with one clear visual metaphor.",
      durationSeconds: 8
    },
    {
      heading: "Set the context",
      voiceover: "First, understand the context. " + (ideas[0] || "Start with the central idea."),
      onScreenText: "Start with the core idea",
      visualPrompt: "A simple diagram or two-column visual that introduces the subject.",
      durationSeconds: 9
    }
  ];
  ideas.slice(1, 4).forEach((idea, index) => {
    scenes.push({
      heading: "Key point " + (index + 1),
      voiceover: idea,
      onScreenText: cleanText(idea, 82),
      visualPrompt: "One focused illustration or labelled diagram for this point: " + cleanText(idea, 180),
      durationSeconds: 10
    });
  });
  scenes.push({
    heading: "Takeaway",
    voiceover: "The main takeaway is to remember the central idea and check each detail before sharing it.",
    onScreenText: "Remember the takeaway",
    visualPrompt: "A concise recap card with three short visual anchors.",
    durationSeconds: 8
  });
  if (format === "square-carousel") return scenes.slice(0, 6).map((scene) => ({ ...scene, durationSeconds: 5 }));
  return scenes.slice(0, format === "vertical-short" ? 6 : 7);
}

function parseGeneratedContent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") throw new TypeError("The content generator returned an unsupported response.");
  const stripped = value.trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/, "");
  const parsed = JSON.parse(stripped);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("The content generator response must be a JSON object.");
  }
  return parsed;
}

function normalizeScene(scene, index, format, now, visualStyle) {
  const heading = cleanText(scene?.heading || scene?.title, 80) || "Scene " + (index + 1);
  const voiceover = cleanText(scene?.voiceover || scene?.narration || scene?.script, MAX_SCENE_TEXT);
  const onScreenText = cleanText(scene?.onScreenText || scene?.caption, 120);
  const visualPrompt = cleanText(scene?.visualPrompt || scene?.visualDirection, MAX_VISUAL_PROMPT);
  if (!voiceover && !onScreenText) throw new TypeError("Every scene needs narration or on-screen text.");
  const sceneText = [heading, voiceover, onScreenText, visualPrompt].join("\n");
  if (SECRET_PATTERN.test(sceneText) || TOKEN_PATTERN.test(sceneText)) {
    throw new TypeError("JARVIS will not keep scene content that appears to contain a credential or secret.");
  }
  if (RESTRICTED_MEDIA_PATTERN.test(sceneText)) {
    throw new TypeError("This media request is outside the supported safe-content scope.");
  }
  return {
    id: cleanText(scene?.id, 80) || crypto.randomUUID(),
    heading,
    voiceover,
    onScreenText,
    visualPrompt,
    visualType: SCENE_VISUAL_TYPES.has(scene?.visualType)
      ? scene.visualType
      : visualStyle === "stick-figure-story" ? "stick-figure"
        : visualStyle === "minimal-editorial" ? "quote" : "auto",
    figurePose: FIGURE_POSES.has(scene?.figurePose)
      ? scene.figurePose
      : ["walk", "point", "think", "celebrate"][index % 4],
    animation: SCENE_ANIMATIONS.has(scene?.animation)
      ? scene.animation
      : ["rise", "walk", "gesture", "bounce"][index % 4],
    background: SCENE_BACKGROUNDS.has(scene?.background)
      ? scene.background
      : ["midnight", "sunset", "paper", "mint", "violet"][index % 5],
    transition: SCENE_TRANSITIONS.has(scene?.transition)
      ? scene.transition
      : index === 0 ? "fade" : ["fade", "slide", "wipe", "zoom"][index % 4],
    cameraMotion: SCENE_CAMERA_MOTIONS.has(scene?.cameraMotion) ? scene.cameraMotion : "static",
    grade: {
      brightness: boundedNumber(scene?.grade?.brightness, 100, 50, 150),
      contrast: boundedNumber(scene?.grade?.contrast, 100, 50, 150),
      saturation: boundedNumber(scene?.grade?.saturation, 100, 0, 180),
      blur: boundedNumber(scene?.grade?.blur, 0, 0, 12)
    },
    durationSeconds: format === "square-carousel" ? 5 : boundedDuration(scene?.durationSeconds, 8, FORMATS[format]?.maxSceneDurationSeconds || 30),
    order: index + 1,
    createdAt: validDate(scene?.createdAt, now)
  };
}

export function normalizeMediaProject(input = {}) {
  const brief = cleanText(input.brief, MAX_BRIEF);
  const title = cleanText(input.title, MAX_TITLE);
  if (!brief) throw new TypeError("Describe what the media should be about.");
  if (!title) throw new TypeError("A project title is required.");
  if (SECRET_PATTERN.test(title + "\n" + brief) || TOKEN_PATTERN.test(title + "\n" + brief)) {
    throw new TypeError("JARVIS will not keep content that appears to contain a credential or secret.");
  }
  if (RESTRICTED_MEDIA_PATTERN.test(title + "\n" + brief)) {
    throw new TypeError("This media request is outside the supported safe-content scope.");
  }
  const audience = cleanText(input.audience, 140) || "General audience";
  if (SECRET_PATTERN.test(audience) || TOKEN_PATTERN.test(audience)) {
    throw new TypeError("JARVIS will not keep audience details that appear to contain a credential or secret.");
  }
  if (RESTRICTED_MEDIA_PATTERN.test(audience)) {
    throw new TypeError("This media audience setting is outside the supported safe-content scope.");
  }
  const selectedFormat = formatKey(input.format);
  const format = FORMATS[selectedFormat];
  const visualStyle = VISUAL_STYLES.has(input.visualStyle) ? input.visualStyle : "cinematic-motion";
  const scenesInput = Array.isArray(input.scenes) ? input.scenes.slice(0, MAX_SCENES) : [];
  if (scenesInput.length < MIN_SCENES) throw new TypeError("A storyboard needs at least two scenes.");
  const now = new Date().toISOString();
  let scenes = scenesInput.map((scene, index) => normalizeScene(scene, index, selectedFormat, now, visualStyle));
  const maxCount = Math.max(MIN_SCENES, Math.min(MAX_SCENES, Math.floor(format.maxDurationSeconds / 3)));
  scenes = scenes.slice(0, maxCount);
  const maxPerScene = Math.max(3, Math.floor(format.maxDurationSeconds / scenes.length));
  scenes = scenes.map((scene) => ({ ...scene, durationSeconds: Math.min(scene.durationSeconds, maxPerScene) }));
  const sceneDurationSeconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  const tracks = normalizeTimelineTracks(input.tracks, scenes, format.maxDurationSeconds);
  const timelineDuration = Math.max(0, ...tracks.flatMap((track) =>
    track.clips.map((clip) => clip.start + clip.duration)
  ));
  const durationSeconds = Math.min(format.maxDurationSeconds,
    Array.isArray(input.tracks) && input.tracks.length ? timelineDuration : Math.max(sceneDurationSeconds, timelineDuration));
  const state = PROJECT_STATES.has(input.status) ? input.status : "draft";
  const createdAt = validDate(input.createdAt, now);
  const updatedAt = validDate(input.updatedAt, createdAt);
  return {
    id: cleanText(input.id, 80) || crypto.randomUUID(),
    title,
    brief,
    format: selectedFormat,
    formatLabel: format.label,
    width: format.width,
    height: format.height,
    platform: PLATFORMS.has(input.platform) ? input.platform : "general",
    language: LANGUAGES.has(input.language) ? input.language : "en-IN",
    tone: TONES.has(input.tone) ? input.tone : "clear",
    audience,
    visualStyle,
    scenes,
    tracks,
    durationSeconds,
    status: state,
    generationSource: input.generationSource === "ai-assisted" ? "ai-assisted" : "local-template",
    generationNote: cleanText(input.generationNote, 260),
    createdAt,
    updatedAt,
    approvedAt: state === "approved" ? validDate(input.approvedAt, updatedAt) : null
  };
}

export async function createMediaDraft(input = {}, options = {}) {
  const brief = cleanText(input.brief, MAX_BRIEF);
  if (!brief) throw new TypeError("Describe what the media should be about.");
  const selectedFormat = formatKey(input.format);
  const visualStyle = VISUAL_STYLES.has(input.visualStyle) ? input.visualStyle : "cinematic-motion";
  const now = new Date().toISOString();
  const isLongForm = selectedFormat === "long-form";
  const targetDurationSeconds = FORMATS[selectedFormat].maxDurationSeconds;
  const base = normalizeMediaProject({
    ...input,
    id: crypto.randomUUID(),
    brief,
    title: cleanText(input.title, MAX_TITLE) || cleanText(brief.split(/[.!?\\n।]/u)[0], MAX_TITLE) || "Untitled media project",
    format: selectedFormat,
    visualStyle,
    scenes: createTemplateScenes(brief, selectedFormat, visualStyle),
    status: "draft",
    generationSource: "local-template",
    generationNote: isLongForm
      ? "Local long-form outline only, not a finished 15-20 minute script. Add complete narration to every chapter or configure the AI generator for a full-length storyboard before export."
      : "A structured local storyboard is ready. Review wording and verify factual claims before exporting.",
    createdAt: now,
    updatedAt: now
  });
  if (typeof options.generate !== "function") return base;
  try {
    const generationRequest = {
      brief: base.brief,
      format: base.format,
      platform: base.platform,
      language: base.language,
      tone: base.tone,
      audience: base.audience,
      visualStyle: base.visualStyle,
      sceneLimit: MAX_SCENES,
      targetDurationSeconds,
      targetDurationLabel: isLongForm ? "15-20 minutes" : formatKey(selectedFormat),
      targetSceneCount: isLongForm ? 30 : null,
      narrationTargetWordsPerScene: isLongForm ? "80-100" : null,
      totalNarrationTargetWords: isLongForm ? "2400-3000" : null,
      generationGuidance: isLongForm
        ? "Create a genuinely complete long-form educational or storytelling script, not a short outline stretched across long scene durations. Return about 30 coherent scenes with 80-100 spoken words per scene, factual transitions, examples, a clear progression and a concise final recap. Aim for 15-20 minutes of spoken narration. Do not repeat filler to reach the target. If the supplied brief does not support enough factual detail, return a shorter honest outline and explain what needs research."
        : "Create a concise, complete storyboard appropriate for the selected output format. Avoid filler and invented factual claims.",
      outputShape: {
        title: "string",
        scenes: [{
          heading: "string", voiceover: "string", onScreenText: "string",
          visualPrompt: "string", visualType: "stick-figure", figurePose: "point",
          animation: "gesture", background: "midnight", transition: "fade",
          cameraMotion: "ken-burns",
          grade: { brightness: 100, contrast: 100, saturation: 100, blur: 0 },
          durationSeconds: isLongForm ? 40 : 8
        }]
      }
    };
    const generated = parseGeneratedContent(await options.generate(generationRequest));
    const normalized = normalizeMediaProject({
      ...base,
      ...generated,
      id: base.id,
      brief: base.brief,
      format: base.format,
      platform: base.platform,
      language: base.language,
      tone: base.tone,
      audience: base.audience,
      visualStyle: base.visualStyle,
      status: "draft",
      approvedAt: null,
      generationSource: "ai-assisted",
      generationNote: "AI-assisted storyboard. Review all wording and verify factual claims before export.",
      tracks: undefined,
      createdAt: base.createdAt,
      updatedAt: new Date().toISOString()
    });
    if (isLongForm && normalized.durationSeconds < 600) {
      normalized.generationNote = "The AI provider returned a shorter outline (" +
        normalized.durationSeconds + " seconds), not a complete 15-20 minute script. Expand the narration and chapters before treating this as long-form.";
    }
    return normalized;
  } catch {
    return {
      ...base,
      generationNote: isLongForm
        ? "The AI content provider was unavailable or returned an invalid draft. This is only a local outline, not a finished 15-20 minute script."
        : "The AI content provider was unavailable or returned an invalid draft. A local storyboard template was used instead."
    };
  }
}

export function updateMediaProject(existing, updates = {}) {
  if (!existing || existing.status !== "draft") throw new TypeError("Only draft media projects can be edited.");
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) throw new TypeError("Media project changes must be an object.");
  return normalizeMediaProject({
    ...existing,
    title: updates.title ?? existing.title,
    audience: updates.audience ?? existing.audience,
    tone: updates.tone ?? existing.tone,
    visualStyle: updates.visualStyle ?? existing.visualStyle,
    scenes: updates.scenes ?? existing.scenes,
    tracks: updates.tracks ?? existing.tracks,
    updatedAt: new Date().toISOString(),
    status: "draft",
    approvedAt: null
  });
}

export function approveMediaProject(existing) {
  if (!existing || existing.status !== "draft") throw new TypeError("Only a draft media project can be approved.");
  const now = new Date().toISOString();
  return normalizeMediaProject({ ...existing, status: "approved", approvedAt: now, updatedAt: now });
}

function formatSrtTime(totalSeconds) {
  const milliseconds = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  const seconds = Math.floor((milliseconds % 60000) / 1000);
  const millis = milliseconds % 1000;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":") +
    "," + String(millis).padStart(3, "0");
}

export function buildMediaCaptions(project) {
  const normalized = normalizeMediaProject(project);
  let cursor = 0;
  return normalized.scenes.map((scene, index) => {
    const start = cursor;
    cursor += scene.durationSeconds;
    return String(index + 1) + "\n" +
      formatSrtTime(start) + " --> " + formatSrtTime(cursor) + "\n" +
      (scene.voiceover || scene.onScreenText).replace(/\s+/g, " ").trim() + "\n";
  }).join("\n");
}

export function buildMediaScript(project) {
  const normalized = normalizeMediaProject(project);
  return [
    normalized.title,
    "Format: " + normalized.formatLabel,
    "Platform: " + normalized.platform,
    "Language: " + normalized.language,
    "Estimated duration: " + normalized.durationSeconds + " seconds",
    "",
    ...normalized.scenes.flatMap((scene, index) => [
      "SCENE " + (index + 1) + " — " + scene.heading,
      "ON SCREEN: " + scene.onScreenText,
      "VOICEOVER: " + scene.voiceover,
      "VISUAL DIRECTION: " + scene.visualPrompt,
      ""
    ]),
    "Review note: Verify factual claims and rights for any assets added before publishing."
  ].join("\n");
}

export const MEDIA_FORMATS = FORMATS;
export const MEDIA_LIMITS = Object.freeze({
  projects: 60,
  brief: MAX_BRIEF,
  title: MAX_TITLE,
  scenes: MAX_SCENES,
  minScenes: MIN_SCENES,
  sceneText: MAX_SCENE_TEXT,
  maxDurationSeconds: MAX_PROJECT_DURATION_SECONDS
});
