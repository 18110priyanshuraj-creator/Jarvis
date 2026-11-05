const QUESTION_PREFIX = /^(?:how\s+(?:do\s+i|can\s+i|to)\b|what\s+(?:is|are|does)\b|why\s+(?:does|is)\b|where\b|when\b|show\s+me\s+how\b|tell\s+me\s+how\b|teach\s+me\s+how\b|can\s+you\s+explain\b|explain\s+how\b|kaise\s+(?:use|banate|banaate|banaun)\b|kya\s+hai\b)/i;
const CREATION_VERB = /\b(?:create|make|build|edit|produce|render|generate|prepare|design|animate|turn|convert|want|need|chahiye|banao|bana|banana|banado|bana\s+do|taiyar\s+karo|taiyaar\s+karo|edit\s+karo)\b/i;
const CREATION_OBJECT = /\b(?:video|animation|stick[ -]?figure|stickman|reel|shorts?|storyboard|thumbnail|poster|motion[ -]?graphics?|intro|outro|clip)\b/i;
const EXTERNAL_APP = /\b(?:canva|capcut|cap\s+cut|inshot|vn\s+editor|kinemaster|adobe\s+express)\b/i;

export function parseMediaCreationIntent(message) {
  const text = typeof message === "string"
    ? message.normalize("NFKC").replace(/\s+/g, " ").trim()
    : "";
  if (!text || text.length > 4000 || QUESTION_PREFIX.test(text)) return null;
  if (EXTERNAL_APP.test(text)) return null;
  if (!CREATION_VERB.test(text) || !CREATION_OBJECT.test(text)) return null;

  const topicMatch = text.match(/\b(?:about|on|explaining|regarding|ke\s+baare\s+mein|par)\s+(.+)$/i);
  const topic = topicMatch?.[1]?.replace(/[?.!।]+$/, "").trim();
  const title = (topic || "New video project").slice(0, 90);
  const visualStyle = /\b(?:stick[ -]?figure|stickman)\b/i.test(text)
    ? "stick-figure-story"
    : /\b(?:minimal|clean\s+typography|editorial)\b/i.test(text)
      ? "minimal-editorial"
      : "cinematic-motion";
  const format = /\b(?:landscape|horizontal|16\s*:\s*9|long[ -]?form|long video)\b/i.test(text)
    ? "landscape-explainer"
    : /\b(?:square|carousel|1\s*:\s*1)\b/i.test(text)
      ? "square-carousel"
      : "vertical-short";
  const platform = /\b(?:youtube\s+shorts|shorts)\b/i.test(text)
    ? "youtube-shorts"
    : /\b(?:instagram|reel|tiktok)\b/i.test(text)
      ? (/\breel\b/i.test(text) ? "instagram-reels" : "tiktok")
      : /\byoutube\b/i.test(text) ? "youtube" : "general";
  const language = /[\u0900-\u097f]/u.test(text)
    ? "hi-IN"
    : /\b(?:banao|banana|bana|mujhe|mein|karo|chahiye|hai|par)\b/i.test(text)
      ? "hinglish"
      : "en-IN";
  const tone = /\b(?:cinematic|documentary)\b/i.test(text)
    ? "documentary"
    : /\b(?:energetic|fast[ -]?paced)\b/i.test(text)
      ? "energetic"
      : "clear";

  return {
    brief: text,
    title,
    format,
    platform,
    language,
    tone,
    audience: "General audience",
    visualStyle
  };
}
