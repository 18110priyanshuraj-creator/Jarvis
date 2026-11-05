const encoder = new TextEncoder();

function clean(value, max = 2000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}
function escapeXml(value) {
  return clean(value).replace(/[<>&'"]/g, character => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  })[character]);
}
function wrapWords(value, maxChars, maxLines = 8) {
  const words = clean(value, 1200).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line += (line ? " " : "") + word;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(" ").length > lines.join(" ").length && lines.length) {
    const last = lines.length - 1;
    if (lines[last].length > maxChars - 1) lines[last] = lines[last].slice(0, maxChars - 2) + "…";
    else lines[last] = lines[last].replace(/[.,;:]?$/, "…");
  }
  return lines;
}
function timestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hours, minutes, secs].map((value, index) => String(value).padStart(index === 0 ? 2 : 2, "0")).join(":");
}
function srtTime(milliseconds) {
  const ms = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const remainder = ms % 1000;
  return String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0") + ":" +
    String(seconds).padStart(2, "0") + "," + String(remainder).padStart(3, "0");
}
function vttTime(milliseconds) {
  return srtTime(milliseconds).replace(",", ".");
}
function csv(value) {
  let text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  if (/^[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function splitCueWords(value, maxCues) {
  const words = clean(value, 1200).split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  const count = Math.max(1, Math.min(maxCues, Math.ceil(words.join(" ").length / 76)));
  const groups = [];
  let cursor = 0;
  for (let index = 0; index < count; index++) {
    const remainingGroups = count - index;
    const take = Math.ceil((words.length - cursor) / remainingGroups);
    const part = words.slice(cursor, cursor + take);
    cursor += take;
    groups.push({ text: wrapWords(part.join(" "), 42, 2).join("\n"), words: part.length });
  }
  return groups.filter(item => item.text);
}

export function buildCreatorCaptions(pack) {
  let cursorMs = 0;
  let cueIndex = 1;
  const cues = [];
  for (const scene of (pack.shortVideo?.scenes || [])) {
    const durationMs = Math.max(1000, Math.round(Math.min(180, Number(scene.durationSeconds) || 8) * 1000));
    const speech = clean(scene.voiceover || scene.onScreenText || scene.heading, 1200);
    const maxCues = Math.max(1, Math.min(6, Math.floor(durationMs / 1500)));
    const groups = splitCueWords(speech, maxCues);
    const totalWords = groups.reduce((sum, item) => sum + item.words, 0);
    let consumedWords = 0;
    for (const group of groups) {
      const start = cursorMs + durationMs * consumedWords / Math.max(1, totalWords);
      consumedWords += group.words;
      const end = cursorMs + durationMs * consumedWords / Math.max(1, totalWords);
      cues.push({ index: cueIndex++, start: Math.round(start), end: Math.round(end), text: group.text });
    }
    cursorMs += durationMs;
  }
  const srt = cues.map(cue => cue.index + "\n" + srtTime(cue.start) + " --> " + srtTime(cue.end) + "\n" + cue.text).join("\n\n");
  const vtt = "WEBVTT\n\n" + cues.map(cue => vttTime(cue.start) + " --> " + vttTime(cue.end) + "\n" + cue.text).join("\n\n");
  return { srt, vtt, durationMs: cursorMs, cueCount: cues.length };
}

export function buildCreatorStoryboardCsv(pack) {
  let cursor = 0;
  const rows = [["scene", "start", "end", "duration_seconds", "heading", "voiceover", "on_screen_text", "visual_prompt"]];
  for (const [index, scene] of (pack.shortVideo?.scenes || []).entries()) {
    const duration = Math.max(1, Math.round(Number(scene.durationSeconds || 8)));
    rows.push([
      index + 1, timestamp(cursor), timestamp(cursor + duration), duration,
      scene.heading, scene.voiceover, scene.onScreenText, scene.visualPrompt
    ]);
    cursor += duration;
  }
  return rows.map(row => row.map(csv).join(",")).join("\r\n") + "\r\n";
}

export function buildYouTubeChapters(pack) {
  const scenes = Array.isArray(pack.shortVideo?.scenes) ? pack.shortVideo.scenes : [];
  const total = scenes.reduce((sum, scene) => sum + Math.max(1, Number(scene.durationSeconds) || 8), 0);
  if (total < 30) throw new Error("YouTube chapters need at least 30 seconds of video and three segments.");
  const groups = [];
  let group = null;
  let cursor = 0;
  for (const scene of scenes) {
    const duration = Math.max(1, Number(scene.durationSeconds) || 8);
    if (!group) group = { start: cursor, duration: 0, headings: [] };
    group.duration += duration;
    group.headings.push(clean(scene.heading, 90) || "Chapter");
    cursor += duration;
    if (group.duration >= 10) {
      groups.push(group);
      group = null;
    }
  }
  if (group) {
    if (groups.length) {
      groups[groups.length - 1].duration += group.duration;
      groups[groups.length - 1].headings.push(...group.headings);
    } else {
      groups.push(group);
    }
  }
  if (groups.length < 3 || groups.some(item => item.duration < 10)) {
    throw new Error("There are not three valid 10-second chapter segments yet. Add more scenes or increase their durations.");
  }
  return groups.map((item, index) => {
    const heading = item.headings[0] + (item.headings.length > 1 ? " + " + (item.headings.length - 1) + " more" : "");
    return timestamp(item.start).replace(/^00:/, "") + " " + (index === 0 ? "Start · " : "") + heading;
  }).join("\n");
}

export function buildCarouselSlideSvg(slide, index, total) {
  const headingLines = wrapWords(slide.heading, 24, 2);
  const bodyLines = wrapWords(slide.body, 36, 8);
  const visualLines = wrapWords(slide.visualPrompt, 48, 2);
  const titleSvg = headingLines.map((line, i) =>
    '<text x="540" y="' + (310 + i * 62) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="50" font-weight="700" fill="#f3fbff">' + escapeXml(line) + "</text>"
  ).join("");
  const bodySvg = bodyLines.map((line, i) =>
    '<text x="540" y="' + (490 + i * 48) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" fill="#d2e5eb">' + escapeXml(line) + "</text>"
  ).join("");
  const promptSvg = visualLines.map((line, i) =>
    '<text x="540" y="' + (880 + i * 26) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#80dce4">' + escapeXml(line) + "</text>"
  ).join("");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" role="img" aria-label="Carousel slide ' + (index + 1) + '">',
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#081b28"/><stop offset="1" stop-color="#123c4a"/></linearGradient></defs>',
    '<rect width="1080" height="1080" fill="url(#bg)"/>',
    '<circle cx="930" cy="170" r="190" fill="#30c5ce" opacity=".10"/>',
    '<circle cx="130" cy="900" r="260" fill="#30c5ce" opacity=".07"/>',
    '<rect x="78" y="78" width="924" height="924" rx="42" fill="none" stroke="#55d6dd" stroke-opacity=".45" stroke-width="3"/>',
    '<text x="110" y="160" font-family="Arial,sans-serif" font-size="23" font-weight="700" letter-spacing="4" fill="#65e2e7">JARVIS CREATOR</text>',
    '<rect x="110" y="210" width="150" height="7" rx="3" fill="#65e2e7"/>',
    titleSvg, bodySvg,
    '<rect x="110" y="825" width="860" height="1" fill="#8bb5c2" opacity=".5"/>',
    promptSvg,
    '<text x="110" y="950" font-family="Arial,sans-serif" font-size="20" fill="#b0cbd3">Swipe for the next point →</text>',
    '<text x="970" y="950" text-anchor="end" font-family="Arial,sans-serif" font-size="20" fill="#b0cbd3">' + (index + 1) + " / " + total + "</text>",
    "</svg>"
  ].join("");
}

export function buildCreatorAssetFiles(pack) {
  const captions = buildCreatorCaptions(pack);
  let cursor = 0;
  const readme = [
    "JARVIS CREATOR CAMPAIGN ASSETS",
    "",
    "Review all wording, source claims, image rights, music rights and platform requirements before publishing.",
    "Captions are scene-level draft cues. Check timing and punctuation against the recorded voiceover.",
    "Carousel slides are 1080x1080 SVG design drafts. Edit them in a graphics editor after import if needed.",
    "YouTube chapters are generated only when the scene plan can form at least three 10-second segments.",
    ""
  ].join("\n");
  const files = [
    { name: "campaign/README.txt", content: readme },
    { name: "campaign/campaign-pack.json", content: JSON.stringify(pack, null, 2) },
    { name: "video/storyboard.csv", content: buildCreatorStoryboardCsv(pack) },
    { name: "video/captions.srt", content: captions.srt },
    { name: "video/captions.vtt", content: captions.vtt }
  ];
  try {
    files.push({ name: "video/youtube-chapters.txt", content: buildYouTubeChapters(pack) });
  } catch {
    files.push({ name: "video/youtube-chapters-not-ready.txt", content: "The current scene plan does not meet YouTube chapter length rules. Add at least three segments of 10 seconds each before using chapters." });
  }
  (pack.carousel?.slides || []).forEach((slide, index, all) => {
    files.push({
      name: "carousel/slide-" + String(index + 1).padStart(2, "0") + ".svg",
      content: buildCarouselSlideSvg(slide, index, all.length)
    });
  });
  return files;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function concatenate(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export function buildStoredZip(files, date = new Date()) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 100) throw new TypeError("A ZIP needs between one and 100 files.");
  const stamp = dosDateTime(date);
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const file of files) {
    const name = encoder.encode(clean(file.name, 240).replace(/\\/g, "/"));
    if (!name.length || name.includes(0)) throw new TypeError("ZIP filenames must be non-empty.");
    const data = encoder.encode(String(file.content ?? ""));
    const checksum = crc32(data);
    if (data.length > 0xffffffff || localOffset > 0xffffffff) throw new RangeError("ZIP32 size limit exceeded.");
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, stamp.time, true); lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, checksum, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, stamp.time, true); cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, checksum, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
    cv.setUint32(42, localOffset, true); central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }
  const centralDirectory = concatenate(centralParts);
  const localData = concatenate(localParts);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralDirectory.length, true); ev.setUint32(16, localData.length, true); ev.setUint16(20, 0, true);
  return concatenate([localData, centralDirectory, end]);
}
