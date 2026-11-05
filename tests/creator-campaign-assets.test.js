import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreatorCaptions,
  buildCreatorStoryboardCsv,
  buildYouTubeChapters,
  buildCarouselSlideSvg,
  buildCreatorCoverSvg,
  buildCreatorAssetFiles,
  buildStoredZip
} from "../public/creator-campaign-assets.js";

const pack = {
  topic: "A simple solar panel explanation",
  shortVideo: {
    scenes: [
      { heading: "Hook", voiceover: "How does sunlight become electricity?", onScreenText: "Sunlight to power", visualPrompt: "A panel in sunlight", durationSeconds: 8 },
      { heading: "Solar cells", voiceover: "Solar cells convert light into electrical energy.", onScreenText: "Light becomes energy", visualPrompt: "Cells on a panel", durationSeconds: 12 },
      { heading: "The inverter", voiceover: "An inverter changes direct current into alternating current.", onScreenText: "The inverter", visualPrompt: "An inverter diagram", durationSeconds: 12 },
      { heading: "The result", voiceover: "The electricity can now power suitable home devices.", onScreenText: "Ready to use", visualPrompt: "A home powered by solar", durationSeconds: 10 }
    ]
  },
  carousel: { slides: [
    { heading: "The question", body: "How does it work?", visualPrompt: "Sunlight" },
    { heading: "Solar cells", body: "They convert light into electrical energy.", visualPrompt: "Solar cell" },
    { heading: "Current", body: "Panels provide direct current.", visualPrompt: "Current flow" },
    { heading: "Inverter", body: "The inverter changes the current type.", visualPrompt: "Inverter" }
  ] }
};

test("builds scene-level SRT and WebVTT captions with contiguous timecodes", () => {
  const result = buildCreatorCaptions(pack);
  assert.equal(result.cueCount, 4);
  assert.match(result.srt, /00:00:00,000 --> 00:00:08,000/);
  assert.match(result.srt, /00:00:08,000 --> 00:00:20,000/);
  assert.match(result.vtt, /^WEBVTT/);
  assert.match(result.vtt, /00:00:20\.000 --> 00:00:32\.000/);
  assert.equal(result.durationMs, 42000);
});

test("splits longer scene narration into short, timed subtitle cues", () => {
  const longPack = {
    shortVideo: { scenes: [{
      voiceover: "A solar panel contains many connected solar cells. Each cell uses light to move electrical charges. The panel produces direct current and an inverter changes it into alternating current for compatible devices.",
      durationSeconds: 30
    }] }
  };
  const captions = buildCreatorCaptions(longPack);
  assert.ok(captions.cueCount > 1);
  assert.match(captions.srt, /00:00:00,000 -->/);
  assert.match(captions.srt, /00:00:30,000/);
  for (const block of captions.srt.trim().split("\n\n")) {
    const lines = block.split("\n");
    assert.ok(lines.slice(2).length <= 2);
  }
});

test("exports a spreadsheet-friendly storyboard CSV with timing and quoted text", () => {
  const csv = buildCreatorStoryboardCsv(pack);
  assert.match(csv, /"scene","start","end","duration_seconds"/);
  assert.match(csv, /00:00:00/);
  assert.match(csv, /"Solar cells"/);
  assert.match(csv, /"Solar cells convert light into electrical energy\."/);
  const unsafe = buildCreatorStoryboardCsv({ shortVideo: { scenes: [{
    heading: "=HYPERLINK(\"https://example.com\")",
    voiceover: "Normal narration",
    durationSeconds: 6
  }] } });
  assert.match(unsafe, /"'=HYPERLINK/);
});

test("creates YouTube chapters with three segments of at least ten seconds", () => {
  const chapters = buildYouTubeChapters(pack);
  const lines = chapters.split("\n");
  assert.equal(lines.length >= 3, true);
  assert.match(lines[0], /^00:00 Start/);
  for (let i = 0; i < lines.length; i++) {
    const timestamp = lines[i].split(" ")[0];
    assert.match(timestamp, /^\d{2}:\d{2}$/);
  }
  assert.throws(() => buildYouTubeChapters({
    shortVideo: { scenes: [{ heading: "A", durationSeconds: 8 }, { heading: "B", durationSeconds: 8 }] }
  }), /at least 30 seconds/);
});

test("escapes text in carousel SVG rather than injecting markup", () => {
  const svg = buildCarouselSlideSvg({
    heading: "<script>alert(1)</script>",
    body: "A & B are useful together.",
    visualPrompt: "Simple illustration"
  }, 0, 4);
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /A &amp; B/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /width="1080" height="1080"/);
  const branded = buildCarouselSlideSvg({ heading: "Brand", body: "A useful point", visualPrompt: "Diagram" }, 0, 4, {
    brandName: "Solar Lab",
    accentColor: "#ff8800",
    backgroundColor: "#101820",
    textColor: "#ffffff"
  }, "Solar energy");
  assert.match(branded, /Solar Lab/);
  assert.match(branded, /#ff8800/);
  assert.match(branded, /#101820/);
  assert.match(branded, /#ffffff/);
});

test("creates branded vertical Reel and landscape YouTube cover templates with escaped text", () => {
  const coverPack = {
    ...pack,
    title: "<Solar energy>",
    shortVideo: { ...pack.shortVideo, title: "How solar power works", hook: "Turn sunlight into useful electricity." },
    brandKit: { brandName: "Solar Lab", accentColor: "#ff8800", backgroundColor: "#101820", textColor: "#ffffff" }
  };
  const reel = buildCreatorCoverSvg(coverPack, "vertical");
  const thumbnail = buildCreatorCoverSvg(coverPack, "landscape");
  assert.match(reel, /width="1080" height="1920"/);
  assert.match(reel, /SOLAR LAB/);
  assert.match(reel, /#ff8800/);
  assert.match(reel, /How solar power works/);
  assert.doesNotMatch(reel, /<Solar energy>/);
  assert.match(thumbnail, /width="1280" height="720"/);
  assert.match(thumbnail, /Turn sunlight into useful electricity/);
  assert.match(thumbnail, /#101820/);
  assert.throws(() => buildCreatorCoverSvg(coverPack, "square"), /vertical Reel cover/);
});

test("bundles carousel SVGs, subtitles, storyboard and chapter readiness in ZIP assets", () => {
  const files = buildCreatorAssetFiles(pack);
  assert.ok(files.some(file => file.name === "video/captions.srt"));
  assert.ok(files.some(file => file.name === "video/captions.vtt"));
  assert.ok(files.some(file => file.name === "video/reel-cover-template.svg"));
  assert.ok(files.some(file => file.name === "video/youtube-thumbnail-template.svg"));
  assert.ok(files.some(file => file.name === "video/storyboard.csv"));
  assert.ok(files.some(file => file.name === "video/youtube-chapters.txt"));
  assert.ok(files.some(file => file.name === "website/seo-page-draft.html"));
  assert.ok(files.some(file => file.name === "social/platform-copy.md"));
  assert.ok(files.some(file => file.name === "ideas/idea-backlog.csv"));
  assert.ok(files.some(file => file.name === "lead/lead-resource-outline.txt"));
  assert.ok(files.some(file => file.name === "research/source-review.txt"));
  assert.ok(files.some(file => file.name === "publishing/pre-publish-checklist.txt"));
  assert.equal(files.filter(file => file.name.startsWith("carousel/slide-")).length, 4);
  const archive = buildStoredZip(files, new Date(2026, 0, 1));
  assert.equal(new DataView(archive.buffer, archive.byteOffset, archive.byteLength).getUint32(0, true), 0x04034b50);
  const archiveText = new TextDecoder().decode(archive);
  assert.match(archiveText, /carousel\/slide-01\.svg/);
  assert.match(archiveText, /video\/captions\.srt/);
  assert.equal(new DataView(archive.buffer, archive.byteOffset, archive.byteLength).getUint32(archive.length - 22, true), 0x06054b50);
});

test("exports a self-contained escaped SEO HTML draft and brand styling in the ZIP files", () => {
  const unsafePack = {
    ...pack,
    brandKit: { brandName: "Solar Lab", accentColor: "#ff8800", backgroundColor: "#101820", textColor: "#ffffff" },
    seoPage: {
      metaTitle: "<script>bad</script>",
      metaDescription: "A & B",
      h1: "<img src=x onerror=alert(1)>",
      sections: [{ heading: "How it works", summary: "<script>no</script>" }],
      faqs: []
    }
  };
  const files = buildCreatorAssetFiles(unsafePack);
  const html = files.find(file => file.name === "website/seo-page-draft.html").content;
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.doesNotMatch(html, /<script>/);
  const slide = files.find(file => file.name === "carousel/slide-01.svg").content;
  assert.match(slide, /Solar Lab/);
  assert.match(slide, /#ff8800/);
  assert.match(slide, /#101820/);
});

test("quotes dangerous spreadsheet formula cells", () => {
  const unsafePack = {
    shortVideo: { scenes: [{ heading: "=HYPERLINK(\"https://example.com\")", voiceover: "Line", durationSeconds: 4 }] }
  };
  assert.match(buildCreatorStoryboardCsv(unsafePack), /"'=HYPERLINK/);
});

test("uses a chapter readiness note instead of fake chapters for clips that are too short", () => {
  const shortPack = { ...pack, shortVideo: { scenes: [{ heading: "Hook", voiceover: "Hi", durationSeconds: 8 }] } };
  const files = buildCreatorAssetFiles(shortPack);
  const chapterFile = files.find(file => file.name.endsWith("youtube-chapters-not-ready.txt"));
  assert.ok(chapterFile);
  assert.match(chapterFile.content, /three segments/);
});

