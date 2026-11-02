import crypto from "node:crypto";

const MAX_BRIEF = 1800;
const MAX_TITLE = 90;
const MAX_SCENES = 12;
const MIN_SCENES = 2;
const MAX_SCENE_TEXT = 900;
const MAX_VISUAL_PROMPT = 360;

const FORMATS = Object.freeze({
  "vertical-short": Object.freeze({ label: "Vertical short", width: 720, height: 1280, maxDurationSeconds: 90 }),
  "landscape-explainer": Object.freeze({ label: "Landscape explainer", width: 1280, height: 720, maxDurationSeconds: 180 }),
  "square-carousel": Object.freeze({ label: "Square carousel", width: 1080, height: 1080, maxDurationSeconds: 60 })
});
const PLATFORMS = new Set(["youtube-shorts", "youtube", "instagram-reels", "instagram-carousel", "tiktok", "general"]);
const LANGUAGES = new Set(["en-IN", "hi-IN", "hinglish"]);
const TONES = new Set(["clear", "friendly", "energetic", "calm", "documentary", "professional"]);
const PROJECT_STATES = new Set(["draft", "approved"]);
const SECRET_PATTERN = /(?:\b|_)(?:api[_ -]?key|access[_ -]?token|password|passcode|one[- ]time code|otp|private key)\b\s*[:=]\s*\S+/i;
const TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/i;
const RESTRICTED_MEDIA_PATTERN = /(?:\b(?:porn(?:ography|ographic)?|erotic|masturbat(?:e|ion)|explicit sexual|nude|suicid(?:e|al)|self[- ]harm|cutting tutorial|weapon construction|build (?:a )?(?:bomb|gun|weapon)|make (?:a )?(?:bomb|explosive)|explosive device|drug synthesis|how to (?:hide|use) (?:drugs|a weapon)|vape tricks|nicotine challenge)\b|आत्महत्या|खुदकुशी|खुद\s+को\s+नुकसान|बम\s+बनाना|बंदूक\s+बनाना|हथियार\s+बनाना|विस्फोटक\s+बनाना|ज़हर\s+बनाना|जहर\s+बनाना|\b(?:khudkushi|aatmahatya|bam|bandook|hathiyar|zehar|zahar)\s+(?:kaise|banana|banaye|banane)\b)/iu;

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\u0000/g, "").trim().slice(0, maxLength) : "";
}

function validDate(value, fallback) {
  const parsed = typeof value === "string" ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function boundedDuration(value, fallback = 8) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(30, Math.max(3, Math.round(parsed)));
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

function createTemplateScenes(brief, format) {
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

function normalizeScene(scene, index, format, now) {
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
    durationSeconds: format === "square-carousel" ? 5 : boundedDuration(scene?.durationSeconds),
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
  const selectedFormat = formatKey(input.format);
  const format = FORMATS[selectedFormat];
  const scenesInput = Array.isArray(input.scenes) ? input.scenes.slice(0, MAX_SCENES) : [];
  if (scenesInput.length < MIN_SCENES) throw new TypeError("A storyboard needs at least two scenes.");
  const now = new Date().toISOString();
  let scenes = scenesInput.map((scene, index) => normalizeScene(scene, index, selectedFormat, now));
  const maxCount = Math.max(MIN_SCENES, Math.min(MAX_SCENES, Math.floor(format.maxDurationSeconds / 3)));
  scenes = scenes.slice(0, maxCount);
  const maxPerScene = Math.max(3, Math.floor(format.maxDurationSeconds / scenes.length));
  scenes = scenes.map((scene) => ({ ...scene, durationSeconds: Math.min(scene.durationSeconds, maxPerScene) }));
  const durationSeconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
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
    audience: cleanText(input.audience, 140) || "General audience",
    scenes,
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
  const now = new Date().toISOString();
  const base = normalizeMediaProject({
    ...input,
    brief,
    title: cleanText(input.title, MAX_TITLE) || cleanText(brief.split(/[.!?\n।]/u)[0], MAX_TITLE) || "Untitled media project",
    format: selectedFormat,
    scenes: createTemplateScenes(brief, selectedFormat),
    status: "draft",
    generationSource: "local-template",
    generationNote: "A structured local storyboard is ready. Review wording and verify factual claims before exporting.",
    createdAt: now,
    updatedAt: now
  });
  if (typeof options.generate !== "function") return base;
  try {
    const generated = parseGeneratedContent(await options.generate({
      brief: base.brief,
      format: base.format,
      platform: base.platform,
      language: base.language,
      tone: base.tone,
      audience: base.audience,
      sceneLimit: MAX_SCENES,
      outputShape: {
        title: "string",
        scenes: [{ heading: "string", voiceover: "string", onScreenText: "string", visualPrompt: "string", durationSeconds: 8 }]
      }
    }));
    return normalizeMediaProject({
      ...base,
      ...generated,
      id: base.id,
      brief: base.brief,
      format: base.format,
      platform: base.platform,
      language: base.language,
      tone: base.tone,
      audience: base.audience,
      status: "draft",
      approvedAt: null,
      generationSource: "ai-assisted",
      generationNote: "AI-assisted storyboard. Review all wording and verify factual claims before export.",
      createdAt: base.createdAt,
      updatedAt: new Date().toISOString()
    });
  } catch {
    return { ...base, generationNote: "The AI content provider was unavailable or returned an invalid draft. A local storyboard template was used instead." };
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
    scenes: updates.scenes ?? existing.scenes,
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
  maxDurationSeconds: 180
});
