export const MAX_CAPTION_CUES = 500;
export const MAX_CAPTION_FILE_CHARS = 250_000;
const MAX_CAPTION_TEXT = 500;
const MAX_CAPTION_DURATION_SECONDS = 20 * 60;

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function cleanCaptionText(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CAPTION_TEXT);
}

function parseTimestamp(value) {
  const match = String(value || "").trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4].padEnd(3, "0"));
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

export function normalizeCaptionCues(value, durationSeconds = MAX_CAPTION_DURATION_SECONDS) {
  const duration = boundedNumber(durationSeconds, MAX_CAPTION_DURATION_SECONDS, 0, MAX_CAPTION_DURATION_SECONDS);
  if (!Array.isArray(value)) return [];
  const usedIds = new Set();
  const normalized = value.slice(0, MAX_CAPTION_CUES).map((cue, index) => {
    const rawId = typeof cue?.id === "string"
      ? cue.id.normalize("NFKC").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 72)
      : "";
    let id = rawId || "caption-" + (index + 1);
    while (usedIds.has(id)) id = (id.slice(0, 64) || "caption") + "-" + (index + 1);
    usedIds.add(id);
    const rawStart = cue?.startSeconds;
    const rawEnd = cue?.endSeconds;
    const parsedStart = rawStart === null || rawStart === undefined || rawStart === "" ? NaN : Number(rawStart);
    const parsedEnd = rawEnd === null || rawEnd === undefined || rawEnd === "" ? NaN : Number(rawEnd);
    const startSeconds = Number.isFinite(parsedStart) ? Math.min(duration, Math.max(0, parsedStart)) : null;
    const endSeconds = Number.isFinite(parsedEnd) ? Math.min(duration, Math.max(0, parsedEnd)) : null;
    const text = cleanCaptionText(cue?.text);
    return { id, startSeconds, endSeconds, text };
  }).filter((cue) =>
    Number.isFinite(cue.startSeconds) &&
    Number.isFinite(cue.endSeconds) &&
    cue.endSeconds > cue.startSeconds &&
    cue.text.length > 0
  );
  return normalized.sort((a, b) =>
    a.startSeconds - b.startSeconds ||
    a.endSeconds - b.endSeconds ||
    a.id.localeCompare(b.id)
  );
}

export function normalizeCaptionStyle(value = {}) {
  const preset = ["bold-box", "classic", "minimal-shadow"].includes(value?.preset)
    ? value.preset
    : "bold-box";
  const position = ["bottom", "middle", "top"].includes(value?.position)
    ? value.position
    : "bottom";
  const size = ["small", "medium", "large"].includes(value?.size)
    ? value.size
    : "medium";
  return { preset, position, size };
}

export function parseTimedCaptionFile(content, durationSeconds = MAX_CAPTION_DURATION_SECONDS) {
  if (typeof content !== "string" || !content.trim()) {
    throw new TypeError("Choose a non-empty SRT or WebVTT subtitle file.");
  }
  if (content.length > MAX_CAPTION_FILE_CHARS) {
    throw new TypeError("Subtitle files must be 250 KB or smaller.");
  }
  const normalized = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const blocks = normalized.split(/\n[ \t]*\n+/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (!lines.length || /^(?:WEBVTT|NOTE\b|STYLE\b|REGION\b)/i.test(lines[0].trim())) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(
      /^\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3})\s+-->\s+((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3})(?:\s+.*)?$/
    );
    if (!timing) continue;
    const startSeconds = parseTimestamp(timing[1]);
    const endSeconds = parseTimestamp(timing[2]);
    const text = cleanCaptionText(lines.slice(timingIndex + 1).join("\n"));
    if (startSeconds === null || endSeconds === null || endSeconds <= startSeconds || !text) continue;
    cues.push({
      id: "imported-caption-" + (cues.length + 1),
      startSeconds,
      endSeconds,
      text
    });
    if (cues.length > MAX_CAPTION_CUES) {
      throw new TypeError("Subtitle files may contain at most 500 cues.");
    }
  }
  const normalizedCues = normalizeCaptionCues(cues, durationSeconds);
  if (!normalizedCues.length) {
    throw new TypeError("No valid timed subtitle cues were found. Check the SRT or WebVTT timestamps.");
  }
  return normalizedCues;
}

export function formatCaptionSrt(cues, durationSeconds = MAX_CAPTION_DURATION_SECONDS) {
  const normalized = normalizeCaptionCues(cues, durationSeconds);
  const timestamp = (seconds) => {
    const total = Math.max(0, Math.round(seconds * 1000));
    const hours = Math.floor(total / 3600000);
    const minutes = Math.floor((total % 3600000) / 60000);
    const secondsPart = Math.floor((total % 60000) / 1000);
    const milliseconds = total % 1000;
    return [hours, minutes, secondsPart].map((value) => String(value).padStart(2, "0")).join(":") +
      "," + String(milliseconds).padStart(3, "0");
  };
  return normalized.map((cue, index) =>
    String(index + 1) + "\n" +
    timestamp(cue.startSeconds) + " --> " + timestamp(cue.endSeconds) + "\n" +
    cue.text + "\n"
  ).join("\n");
}
