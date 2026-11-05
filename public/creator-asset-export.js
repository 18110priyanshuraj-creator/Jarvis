const encoder = new TextEncoder();

function clean(value, max = 1200) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : fallback;
}

function csvCell(value) {
  let text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  if (/^[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function timecode(seconds, separator = ",") {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const wholeSeconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return [hours, minutes, wholeSeconds].map(n => String(n).padStart(2, "0")).join(":") +
    separator + String(millis).padStart(3, "0");
}

function wordsToCueGroups(text, maxGroups) {
  const words = clean(text, 900).split(/\s+/u).filter(Boolean);
  if (!words.length) return [];
  const count = Math.max(1, Math.min(maxGroups, Math.ceil(words.join(" ").length / 76)));
  const groups = [];
  let cursor = 0;
  for (let index = 0; index < count; index++) {
    const remainingGroups = count - index;
    const remainingWords = words.length - cursor;
    const take = Math.ceil(remainingWords / remainingGroups);
    const group = words.slice(cursor, cursor + take);
    cursor += take;
    const lines = [];
    let line = "";
    for (const word of group) {
      const next = line ? line + " " + word : word;
      if (line && next.length > 42) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    groups.push(lines.slice(0, 2));
  }
  return groups.filter(group => group.length);
}

export function buildCreatorSrt(campaign) {
  const scenes = Array.isArray(campaign?.shortVideo?.scenes) ? campaign.shortVideo.scenes : [];
  let sceneStart = 0;
  let cueIndex = 1;
  const blocks = [];
  for (const scene of scenes) {
    const duration = Math.max(3, Math.min(30, Number(scene.durationSeconds) || 8));
    const speech = clean(scene.voiceover || scene.onScreenText, 900);
    const groups = wordsToCueGroups(speech, Math.max(1, Math.min(5, Math.floor(duration / 1.5))));
    if (groups.length) {
      const weights = groups.map(group => Math.max(1, group.join(" ").split(/\s+/u).length));
      const totalWeight = weights.reduce((sum, value) => sum + value, 0);
      let offset = 0;
      groups.forEach((group, index) => {
        const start = sceneStart + duration * offset / totalWeight;
        offset += weights[index];
        const end = index === groups.length - 1
          ? sceneStart + duration
          : sceneStart + duration * offset / totalWeight;
        blocks.push(String(cueIndex++) + "\n" + timecode(start) + " --> " + timecode(end) + "\n" + group.join("\n"));
      });
    }
    sceneStart += duration;
  }
  return blocks.join("\n\n") + (blocks.length ? "\n" : "");
}

export function buildCreatorShotListCsv(campaign) {
  const scenes = Array.isArray(campaign?.shortVideo?.scenes) ? campaign.shortVideo.scenes : [];
  const rows = [["Scene", "Start", "End", "Duration seconds", "Heading", "Voiceover", "On-screen text", "Visual direction"]];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    const duration = Math.max(3, Math.min(30, Number(scene.durationSeconds) || 8));
    rows.push([
      index + 1, timecode(cursor, "."), timecode(cursor + duration, "."), duration,
      scene.heading, scene.voiceover, scene.onScreenText, scene.visualPrompt
    ]);
    cursor += duration;
  });
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, character => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  })[character]);
}

function wrapLines(value, maxChars, maxLines) {
  const words = clean(value, 600).split(/\s+/u).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (line && next.length > maxChars) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else line = next;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length && words.join(" ").length > lines.join(" ").length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/[.…]*$/, "") + "…";
  }
  return lines;
}

function svgText(lines, x, y, size, color, weight, lineHeight) {
  return '<text x="' + x + '" y="' + y + '" fill="' + color +
    '" font-family="Arial, Helvetica, sans-serif" font-size="' + size +
    '" font-weight="' + weight + '">' +
    lines.map((line, index) => '<tspan x="' + x + '" dy="' + (index === 0 ? 0 : lineHeight) +
      '">' + escapeXml(line) + "</tspan>").join("") + "</text>";
}

export function buildCreatorCarouselSlideSvg(campaign, slideIndex) {
  const slides = Array.isArray(campaign?.carousel?.slides) ? campaign.carousel.slides : [];
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= slides.length) {
    throw new RangeError("Choose a slide that exists in this carousel.");
  }
  const slide = slides[slideIndex];
  const brand = campaign?.brandKit || {};
  const accent = safeColor(brand.accentColor, "#1fc7d4");
  const background = safeColor(brand.backgroundColor, "#071a24");
  const foreground = safeColor(brand.textColor, "#f2fbff");
  const brandName = clean(brand.brandName, 60) || "JARVIS CREATOR STUDIO";
  const titleLines = wrapLines(slide.heading || campaign.carousel.title || "Key idea", 24, 3);
  const bodyLines = wrapLines(slide.body, 38, 7);
  const titleY = 300;
  const bodyY = titleY + titleLines.length * 72 + 56;
  const total = slides.length;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" role="img" aria-labelledby="slide-title slide-desc">',
    "<title id=\"slide-title\">" + escapeXml(slide.heading) + "</title>",
    "<desc id=\"slide-desc\">" + escapeXml(slide.body) + "</desc>",
    "<defs><linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"" + background + "\"/><stop offset=\"100%\" stop-color=\"#02080d\"/></linearGradient></defs>",
    '<rect width="1080" height="1080" fill="url(#bg)"/>',
    '<circle cx="940" cy="150" r="270" fill="' + accent + '" opacity=".10"/>',
    '<path d="M0 910 L1080 730 L1080 1080 L0 1080Z" fill="' + accent + '" opacity=".08"/>',
    '<rect x="88" y="94" width="108" height="9" rx="4" fill="' + accent + '"/>',
    svgText([brandName.toUpperCase()], 88, 155, 26, accent, 700, 34),
    svgText(["0" + (slideIndex + 1) + " / " + String(total).padStart(2, "0")], 990, 155, 22, foreground, 600, 28).replace('text-anchor="', 'text-anchor="'),
    svgText(titleLines, 88, titleY, 64, foreground, 700, 74),
    svgText(bodyLines, 90, bodyY, 34, foreground, 400, 48),
    '<rect x="88" y="940" width="904" height="2" fill="' + accent + '" opacity=".5"/>',
    svgText([clean(campaign.topic, 64)], 88, 995, 20, foreground, 400, 28),
    "</svg>"
  ].join("");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view, offset, value) { view.setUint16(offset, value, true); }
function write32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

export function buildCreatorCarouselZip(campaign) {
  const slides = Array.isArray(campaign?.carousel?.slides) ? campaign.carousel.slides : [];
  if (slides.length < 4 || slides.length > 8) throw new TypeError("A carousel export needs four to eight slides.");
  const title = clean(campaign.title || campaign.topic, 80).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "creator-carousel";
  const files = slides.map((slide, index) => ({
    name: "slides/slide-" + String(index + 1).padStart(2, "0") + ".svg",
    bytes: encoder.encode(buildCreatorCarouselSlideSvg(campaign, index))
  }));
  const readme = [
    "JARVIS CREATOR STUDIO — CAROUSEL EXPORT",
    "Each SVG is a separate 1080 × 1080 vector slide.",
    "Import SVGs into Canva or another design editor to refine the design.",
    "Review text, facts, source links and image rights before publishing.",
    "Topic: " + clean(campaign.topic, 180)
  ].join("\n");
  files.push({ name: "README.txt", bytes: encoder.encode(readme) });

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, 0);
    write32(localView, 14, crc);
    write32(localView, 18, file.bytes.length);
    write32(localView, 22, file.bytes.length);
    write16(localView, 26, nameBytes.length);
    write16(localView, 28, 0);
    local.set(nameBytes, 30);
    localParts.push(local, file.bytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(central.buffer);
    write32(view, 0, 0x02014b50);
    write16(view, 4, 20);
    write16(view, 6, 20);
    write16(view, 8, 0x0800);
    write16(view, 10, 0);
    write16(view, 12, 0);
    write16(view, 14, 0);
    write32(view, 16, crc);
    write32(view, 20, file.bytes.length);
    write32(view, 24, file.bytes.length);
    write16(view, 28, nameBytes.length);
    write16(view, 30, 0);
    write16(view, 32, 0);
    write16(view, 34, 0);
    write16(view, 36, 0);
    write32(view, 38, 0);
    write32(view, 42, localOffset);
    central.set(nameBytes, 46);
    centralParts.push(central);
    localOffset += local.length + file.bytes.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, localOffset);
  write16(endView, 20, 0);
  const size = localParts.reduce((sum, part) => sum + part.length, 0) + centralSize + end.length;
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
