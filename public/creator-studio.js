import { drawThumbnailCanvas, drawStickFigureFrame, canvasToPng, recordStickFigurePreview } from "./creator-renderer.js";

const STORAGE_KEY = "jarvis.creator-studio.v1";
const POSES = [
  { id: "idle", label: "Idle / neutral", arms: [[50, 76, 27, 104], [50, 76, 73, 104]], legs: [[50, 119, 34, 158], [50, 119, 66, 158]] },
  { id: "walk", label: "Walking", arms: [[50, 76, 27, 93], [50, 76, 75, 58]], legs: [[50, 119, 22, 150], [50, 119, 80, 145]] },
  { id: "point", label: "Pointing", arms: [[50, 76, 22, 55], [50, 76, 91, 63]], legs: [[50, 119, 34, 158], [50, 119, 66, 158]] },
  { id: "think", label: "Thinking", arms: [[50, 76, 29, 111], [50, 76, 69, 49]], legs: [[50, 119, 34, 158], [50, 119, 66, 158]] },
  { id: "surprised", label: "Surprised", arms: [[50, 76, 21, 45], [50, 76, 79, 45]], legs: [[50, 119, 30, 158], [50, 119, 70, 158]] },
  { id: "explaining", label: "Explaining", arms: [[50, 76, 22, 66], [50, 76, 82, 85]], legs: [[50, 119, 34, 158], [50, 119, 66, 158]] }
];
const CHAPTERS = [
  { id: "hook", name: "Cold open / hook", share: 0.035, job: "Show the outcome, surprising question or central tension before the introduction." },
  { id: "promise", name: "The promise", share: 0.055, job: "Explain what the viewer will understand and why the answer matters." },
  { id: "context", name: "Context and first principle", share: 0.16, job: "Define the problem, introduce only the terms needed and establish a baseline example." },
  { id: "build", name: "Build the explanation", share: 0.23, job: "Develop the central idea one step at a time. Change visual when the idea changes." },
  { id: "example", name: "Worked example / demonstration", share: 0.2, job: "Prove the explanation with a specific example, diagram, calculation or demonstration." },
  { id: "twist", name: "Common mistake / deeper insight", share: 0.14, job: "Address the most likely misconception and show what changes when it is corrected." },
  { id: "payoff", name: "Payoff and recap", share: 0.13, job: "Resolve the opening hook, summarize the useful takeaways and show the complete picture." },
  { id: "next", name: "Next step", share: 0.05, job: "Give one relevant next action or link to the next related video. Keep the ending brief." }
];
const $ = (id) => document.getElementById(id);

function clean(value, max = 600) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function safeFilename(value) {
  return clean(value, 70).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "jarvis-creator";
}

function download(name, data, type) {
  const blob = new Blob([data], { type: type || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function timestamp(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return String(Math.floor(s / 3600)).padStart(2, "0") + ":" +
    String(Math.floor((s % 3600) / 60)).padStart(2, "0") + ":" +
    String(s % 60).padStart(2, "0");
}

function csvCell(value) {
  return '"' + String(value ?? "").replace(/"/g, '""') + '"';
}

function distributeDurations(totalSeconds) {
  const raw = CHAPTERS.map((item) => Math.max(10, Math.round(totalSeconds * item.share)));
  const delta = totalSeconds - raw.reduce((sum, value) => sum + value, 0);
  raw[4] += delta;
  return raw;
}

export function makeCreatorPlan(input) {
  const topic = clean(input.topic, 180);
  if (topic.length < 8) throw new TypeError("Add a specific topic or question (at least 8 characters).");
  const audience = clean(input.audience, 140) || "Curious general audience";
  const language = input.language === "hi-IN" ? "Hindi / Hinglish" : "English";
  const durationMinutes = Math.min(20, Math.max(4, Number(input.duration) || 8));
  const totalSeconds = durationMinutes * 60;
  const durations = distributeDurations(totalSeconds);
  let cursor = 0;
  const chapters = CHAPTERS.map((chapter, index) => {
    const duration = durations[index];
    const item = {
      ...chapter,
      durationSeconds: duration,
      startSeconds: cursor,
      endSeconds: cursor + duration,
      visual: index === 0 ? "Open on the result or question; one clear subject." :
        index === 4 ? "Stick figure points to a labelled example, diagram or demonstration." :
          index === 6 ? "Return to the opening visual and reveal the answer." :
            "Stick figure pose + one diagram, prop or supporting visual."
    };
    cursor += duration;
    return item;
  });
  const titleIdeas = [
    "Why " + topic + " works (explained clearly)",
    "The surprising idea behind " + topic,
    topic + ": the full explanation, step by step"
  ];
  const hook = [
    "Question: What would happen if " + topic + "?",
    "Contrast: The obvious explanation sounds right—but it misses one important detail.",
    "Demonstration: Show a quick visual result first, then ask: “Why did that happen?”"
  ];
  return {
    topic, audience, language, durationMinutes, totalSeconds, chapters, titleIdeas, hook,
    thumbnailText: topic.split(/\s+/).slice(0, 5).join(" ").toUpperCase(),
    description: "In this video, we explore " + topic + " step by step. " +
      "You will see the key idea, a worked example, and the common mistake to avoid.\n\n" +
      "Chapters:\n" + chapters.map((item) => timestamp(item.startSeconds) + " " + item.name).join("\n") +
      "\n\nCheck the sources and any important details shown in the video before publishing."
  };
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;"
  })[character]);
}

export function makeStickFigureSvg(poseId, title = "JARVIS stick figure") {
  const pose = POSES.find((item) => item.id === poseId) || POSES[0];
  const [leftArm, rightArm] = pose.arms;
  const [leftLeg, rightLeg] = pose.legs;
  const line = (points, width = 7) =>
    '<polyline points="' + points.map((point) => point.join(",")).join(" ") +
    '" fill="none" stroke="#0c6270" stroke-width="' + width +
    '" stroke-linecap="round" stroke-linejoin="round"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 120 180" role="img" aria-label="' +
    escapeXml(title) + '">' +
    '<rect width="120" height="180" rx="12" fill="#e9fbfb"/>' +
    '<path d="M12 164H108" stroke="#8bbec2" stroke-width="1.5"/>' +
    '<circle cx="50" cy="37" r="18" fill="#ffffff" stroke="#0c6270" stroke-width="6"/>' +
    '<circle cx="44" cy="35" r="1.7" fill="#0c6270"/><circle cx="56" cy="35" r="1.7" fill="#0c6270"/>' +
    '<path d="M45 44Q50 48 55 44" fill="none" stroke="#0c6270" stroke-width="1.8" stroke-linecap="round"/>' +
    line([[50, 56], [50, 76], [50, 119]], 7) +
    line([[50, 76], [leftArm[2], leftArm[3]]]) +
    line([[50, 76], [rightArm[2], rightArm[3]]]) +
    line([[50, 119], [leftLeg[2], leftLeg[3]]]) +
    line([[50, 119], [rightLeg[2], rightLeg[3]]]) +
    '<circle cx="' + leftArm[2] + '" cy="' + leftArm[3] + '" r="2.5" fill="#0c6270"/>' +
    '<circle cx="' + rightArm[2] + '" cy="' + rightArm[3] + '" r="2.5" fill="#0c6270"/>' +
    '<text x="60" y="174" text-anchor="middle" font-family="Arial,sans-serif" font-size="5" fill="#0c6270">' +
    escapeXml(pose.label) + "</text></svg>";
}

export function makeThumbnailSvg(topic, thumbnailText) {
  const title = clean(thumbnailText || topic, 54).toUpperCase();
  const words = title.split(/\s+/).filter(Boolean);
  const firstLine = escapeXml(words.slice(0, 3).join(" "));
  const secondLine = escapeXml(words.slice(3, 6).join(" "));
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="YouTube thumbnail concept">' +
    '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071a24"/><stop offset="1" stop-color="#07566a"/></linearGradient></defs>' +
    '<rect width="1280" height="720" fill="url(#bg)"/>' +
    '<circle cx="1040" cy="340" r="245" fill="#1cc4cb" opacity=".16"/>' +
    '<path d="M0 630L1280 500V720H0Z" fill="#031017" opacity=".45"/>' +
    '<text x="88" y="170" fill="#63edf0" font-family="Arial,sans-serif" font-size="28" font-weight="700" letter-spacing="8">JARVIS EXPLAINER</text>' +
    '<text x="88" y="320" fill="#f4fdff" font-family="Arial,sans-serif" font-size="86" font-weight="900">' + firstLine + '</text>' +
    (secondLine ? '<text x="88" y="430" fill="#8df6ee" font-family="Arial,sans-serif" font-size="86" font-weight="900">' + secondLine + '</text>' : '') +
    '<g transform="translate(880 170)" fill="none" stroke="#f1ffff" stroke-width="24" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="125" cy="82" r="68" fill="#f1ffff" stroke="none"/>' +
    '<circle cx="103" cy="72" r="7" fill="#07566a" stroke="none"/><circle cx="148" cy="72" r="7" fill="#07566a" stroke="none"/>' +
    '<path d="M105 104Q125 121 145 104" stroke="#07566a" stroke-width="7"/>' +
    '<path d="M125 155V360M125 208L18 292M125 208L245 150M125 360L48 510M125 360L210 505"/>' +
    '</g>' +
    '<text x="88" y="630" fill="#c9e7ed" font-family="Arial,sans-serif" font-size="25" letter-spacing="3">CLEAR IDEA · ONE VISUAL · HONEST PROMISE</text>' +
    '</svg>';
}

export function makePoseSheet() {
  const poses = POSES.map((pose, index) => {
    const svg = makeStickFigureSvg(pose.id, pose.label);
    const inner = svg.slice(svg.indexOf("<circle"), svg.indexOf("</svg>"));
    const x = 10 + (index % 3) * 160;
    const y = 10 + Math.floor(index / 3) * 200;
    return '<g transform="translate(' + x + " " + y + ')">' +
      '<rect width="140" height="180" rx="10" fill="#e9fbfb"/>' +
      '<g transform="translate(10 0) scale(.98 1)">' + inner + "</g>" +
      '<text x="70" y="168" text-anchor="middle" font-family="Arial" font-size="10" fill="#0c6270">' +
      escapeXml(pose.label) + "</text></g>";
  }).join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="400" viewBox="0 0 500 400">' +
    '<rect width="500" height="400" fill="#0c1820"/>' + poses + "</svg>";
}

export function makeCreatorStoryboardCsv(plan) {
  const rows = [["Chapter", "Start", "End", "Duration seconds", "Narration prompt", "Visual direction"]];
  for (const chapter of plan.chapters) {
    rows.push([
      chapter.name, timestamp(chapter.startSeconds), timestamp(chapter.endSeconds),
      chapter.durationSeconds, chapter.job, chapter.visual
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function makeCreatorScriptMarkdown(plan, fullScript) {
  const lines = [
    "# " + plan.topic,
    "",
    "**Audience:** " + plan.audience,
    "**Language:** " + plan.language,
    "**Target duration:** " + plan.durationMinutes + " minutes",
    "",
    "## Title options",
    ...plan.titleIdeas.map((title) => "- " + title),
    "",
    "## Hook options",
    ...plan.hook.map((item) => "- " + item),
    "",
    "## Chapter plan",
    ...plan.chapters.map((chapter) =>
      "### " + timestamp(chapter.startSeconds) + " — " + chapter.name +
      "\n\n" + chapter.job +
      "\n\n**Visual:** " + chapter.visual +
      "\n\n**Target length:** " + chapter.durationSeconds + " seconds"
    ),
    "",
    "## Full narration draft",
    "",
    fullScript || "Full narration has not been generated yet. Use “Write full script with JARVIS” and review every factual claim.",
    "",
    "## Publishing checklist",
    "- Verify facts and keep a source list for important claims.",
    "- Confirm title and thumbnail accurately represent the video.",
    "- Check spelling, captions, audio levels and export on a phone.",
    "- Confirm rights for every clip, image, font and audio track.",
    "- Review privacy and audience settings before any upload."
  ];
  return lines.join("\n");
}

function buildAiPrompt(plan) {
  return [
    "Create an original, detailed educational/general-audience YouTube narration script.",
    "Topic: " + plan.topic,
    "Audience: " + plan.audience,
    "Language: " + plan.language,
    "Target duration: " + plan.durationMinutes + " minutes.",
    "Write natural spoken language rather than an essay. Use the following chapter plan and approximate timing:",
    ...plan.chapters.map((chapter) =>
      timestamp(chapter.startSeconds) + "–" + timestamp(chapter.endSeconds) + " " + chapter.name +
      ": " + chapter.job
    ),
    "Requirements:",
    "1. Begin with a truthful hook in the first 10–15 seconds. Pay off the opening promise.",
    "2. Include narration, concise on-screen text, stick-figure pose/action and supporting visual direction for each chapter.",
    "3. Add a clear curiosity question or useful transition between major sections, but do not use fake cliffhangers.",
    "4. Include at least one worked example or demonstration and explain it accurately.",
    "5. Mark factual claims that need source verification as [VERIFY SOURCE]; do not invent citations, statistics or quotes.",
    "6. Keep the ending short and useful. No generic long intro or unrelated subscribe request.",
    "7. Do not copy a known creator's script. Create fresh wording.",
    "8. Include two accurate title options, a thumbnail concept, a concise description, and chapter timestamps.",
    "9. Keep pacing natural; do not pad the script just to reach the requested duration.",
    "Output a complete script in the requested language. Use headings and label Narration, Visual, On-screen text, and Stick-figure action."
  ].join("\n");
}

function loadSaved() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (parsed && typeof parsed === "object") return parsed;
  } catch { /* ignore invalid local browser draft */ }
  return {};
}

export function createCreatorStudio({ api, toast }) {
  let plan = null;
  let fullScript = "";
  let skillDraft = null;
  let canvaStatus = null;

  function status(message, error = false) {
    const target = $("creator-status");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("error-text", error);
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        topic: $("creator-topic")?.value || "",
        audience: $("creator-audience")?.value || "",
        language: $("creator-language")?.value || "hi-IN",
        duration: $("creator-duration")?.value || "8",
        thumbnailTitle: $("creator-thumbnail-title")?.value || "",
        thumbnailSubtitle: $("creator-thumbnail-subtitle")?.value || "",
        fullScript,
        plan
      }));
      status("Draft saved in this browser on this device.");
    } catch {
      status("This browser could not save the local draft. Export it to keep a copy.", true);
    }
  }

  function restore() {
    const saved = loadSaved();
    if (saved.topic) $("creator-topic").value = saved.topic;
    if (saved.audience) $("creator-audience").value = saved.audience;
    if (saved.language) $("creator-language").value = saved.language;
    if (saved.duration) $("creator-duration").value = saved.duration;
    if (typeof saved.thumbnailTitle === "string") $("creator-thumbnail-title").value = saved.thumbnailTitle;
    if (typeof saved.thumbnailSubtitle === "string") $("creator-thumbnail-subtitle").value = saved.thumbnailSubtitle;
    fullScript = typeof saved.fullScript === "string" ? saved.fullScript : "";
    if (saved.plan && Array.isArray(saved.plan.chapters)) {
      plan = saved.plan;
      renderPlan();
    }
  }

  function renderPlan() {
    const target = $("creator-chapters");
    if (!target || !plan) return;
    target.replaceChildren();
    for (const chapter of plan.chapters) {
      const card = document.createElement("article");
      card.className = "creator-chapter";
      const heading = document.createElement("strong");
      heading.textContent = timestamp(chapter.startSeconds) + " · " + chapter.name;
      const time = document.createElement("span");
      time.className = "creator-time";
      time.textContent = chapter.durationSeconds + " sec";
      const copy = document.createElement("p");
      copy.textContent = chapter.job;
      const visual = document.createElement("p");
      visual.className = "small muted";
      visual.textContent = "Visual: " + chapter.visual;
      card.append(heading, time, copy, visual);
      target.append(card);
    }
    $("creator-plan-summary").textContent =
      plan.durationMinutes + " min · " + plan.chapters.length + " chapters · " + plan.language;
    $("creator-title-ideas").replaceChildren();
    for (const title of plan.titleIdeas) {
      const item = document.createElement("li");
      item.textContent = title;
      $("creator-title-ideas").append(item);
    }
    $("creator-hook-ideas").replaceChildren();
    for (const hook of plan.hook) {
      const item = document.createElement("li");
      item.textContent = hook;
      $("creator-hook-ideas").append(item);
    }
    $("creator-description").value = plan.description;
    renderCreatorCanvases();
    $("creator-full-script").value = fullScript;
    $("creator-output").classList.remove("hidden");
    renderFigure();
  }

  function renderFigure() {
    const pose = $("creator-pose")?.value || "idle";
    const preview = $("creator-figure-preview");
    if (preview) preview.innerHTML = makeStickFigureSvg(pose);
    const description = $("creator-pose-description");
    if (description) description.textContent =
      (POSES.find((item) => item.id === pose)?.label || "Neutral") +
      " pose · upload the exported SVG to Canva as a reusable vector asset.";
  }

  async function generatePlan(event) {
    event?.preventDefault();
    try {
      plan = makeCreatorPlan({
        topic: $("creator-topic").value,
        audience: $("creator-audience").value,
        language: $("creator-language").value,
        duration: $("creator-duration").value
      });
      if (!$("creator-thumbnail-title").value.trim()) {
        $("creator-thumbnail-title").value = plan.thumbnailText;
      }
      fullScript = "";
      renderPlan();
      persist();
      status("Outline created. Use “Write full script with JARVIS” to expand it into narration.");
    } catch (error) {
      status(error.message, true);
    }
  }

  async function writeFullScript() {
    if (!plan) {
      await generatePlan();
      if (!plan) return;
    }
    const button = $("creator-write-script");
    button.disabled = true;
    status("JARVIS is drafting the narration. Review all claims before recording…");
    try {
      const result = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          message: buildAiPrompt(plan),
          applicationId: "web-dashboard"
        })
      });
      const reply = typeof result.reply === "string" ? result.reply.trim() : "";
      if (!reply) throw new Error("JARVIS returned no script text. Try again or use the outline export.");
      fullScript = reply.slice(0, 36000);
      $("creator-full-script").value = fullScript;
      persist();
      status("Full script received. Check facts, timings, pronunciation and sources before recording.");
    } catch (error) {
      status(error.message + " The outline is still available.", true);
    } finally {
      button.disabled = false;
    }
  }

  function exportScript() {
    if (!plan) return toast("Create a video outline first.", true);
    fullScript = $("creator-full-script").value.trim();
    download(safeFilename(plan.topic) + "-creator-script.md", makeCreatorScriptMarkdown(plan, fullScript));
    status("Script exported as Markdown.");
  }

  function exportCsv() {
    if (!plan) return toast("Create a video outline first.", true);
    download(safeFilename(plan.topic) + "-storyboard.csv", makeCreatorStoryboardCsv(plan), "text/csv;charset=utf-8");
    status("Storyboard exported as CSV. Import the timings into your editor manually.");
  }

  function exportDescription() {
    if (!plan) return toast("Create a video outline first.", true);
    const chapterText = plan.chapters.map((chapter) =>
      timestamp(chapter.startSeconds) + " " + chapter.name
    ).join("\n");
    const description = $("creator-description").value.trim();
    download(safeFilename(plan.topic) + "-youtube-description.txt",
      description + "\n\nChapters\n" + chapterText + "\n\nSources\nAdd the verified sources used in this video.");
    status("YouTube description template exported.");
  }

  function exportFigure() {
    const pose = $("creator-pose").value || "idle";
    download("jarvis-stick-figure-" + pose + ".svg", makeStickFigureSvg(pose), "image/svg+xml;charset=utf-8");
    status("Stick-figure SVG exported. Upload it to Canva and animate or duplicate it there.");
  }

  function exportPoseSheet() {
    download("jarvis-stick-figure-pose-sheet.svg", makePoseSheet(), "image/svg+xml;charset=utf-8");
    status("Pose sheet exported as SVG.");
  }

  function renderCreatorCanvases() {
    const options = {
      title: $("creator-thumbnail-title")?.value || plan?.topic || "A BIG QUESTION",
      subtitle: $("creator-thumbnail-subtitle")?.value || "",
      pose: $("creator-pose")?.value || "point"
    };
    if ($("creator-thumbnail-canvas")) drawThumbnailCanvas($("creator-thumbnail-canvas"), options);
    if ($("creator-motion-canvas")) drawStickFigureFrame($("creator-motion-canvas"), options, 4);
  }

  async function exportThumbnail() {
    const button = $("creator-export-thumbnail");
    button.disabled = true;
    try {
      renderCreatorCanvases();
      const blob = await canvasToPng($("creator-thumbnail-canvas"));
      download(safeFilename(plan?.topic || "jarvis") + "-youtube-thumbnail.png", blob, "image/png");
      status("1280 × 720 thumbnail exported. Check mobile readability before using it.");
    } catch (error) {
      status(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function exportMotionSample() {
    const button = $("creator-export-motion");
    button.disabled = true;
    try {
      const blob = await recordStickFigurePreview($("creator-motion-canvas"), {
        title: $("creator-thumbnail-title")?.value || plan?.topic || "Explaining an idea",
        subtitle: $("creator-thumbnail-subtitle")?.value || ""
      });
      download(safeFilename(plan?.topic || "jarvis") + "-stick-figure-motion.webm", blob, "video/webm");
      status("Silent stick-figure WebM sample exported. Add voiceover and adjust scene timing in Canva.");
    } catch (error) {
      status(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function createSkill() {
    const button = $("creator-skill-create");
    button.disabled = true;
    try {
      const existing = await api("/api/skills");
      const found = (existing.skills || []).find((item) =>
        item.name === "Creator Studio — Canva & YouTube"
      );
      if (found) {
        skillDraft = found;
        const latest = (found.versions || []).find((item) => item.version === found.currentVersion);
        if (latest?.validation?.passed && latest.validation.version === found.currentVersion && !found.activeVersion) {
          $("creator-skill-approve").classList.remove("hidden");
          status("A tested Creator Studio skill draft already exists. Review it, then activate it below.");
        } else {
          status(found.activeVersion ? "Creator Studio skill is already active." : "Creator Studio skill exists. Review its test status in Memory → Learning & Skills.");
        }
        return;
      }
      const draft = await api("/api/skills", {
        method: "POST",
        body: JSON.stringify({
          name: "Creator Studio — Canva & YouTube",
          instructions: "Help plan and improve original educational or general-audience videos. Start with audience, specific viewer question, promise, platform, language and duration. Create truthful hooks, clear title and thumbnail concepts, long-form chapter outline, natural narration, shot list, on-screen text, captions and a storyboard. For stick figures, use a consistent circle head, torso and separate limb lines, with a reusable pose library. Explain how to build the design in Canva using its timeline, tracks, audio, captions, transitions and export. On Android 12L/API 32+, JARVIS may attempt one semantic drag only when the user supplies two different exact accessible labels, Canva is foreground-verified, and the app exposes ACTION_DRAG_START and ACTION_DRAG_DROP; verify the visible result immediately. Do not claim precision trimming, splitting, keyframes or unsupported timeline controls. Use Creator Studio exports for scripts, storyboard CSV, YouTube description and SVG character assets. Suggest reviewing YouTube Analytics (impressions, CTR, first 30-second retention, average view duration and dips) against the channel's own comparable videos. Never promise viral views or 100% reach; never fabricate stats or sources. Keep the owner in control of media rights, final file selection, privacy/audience declarations and publishing. Device control includes exact accessible app actions and the narrowly scoped Canva semantic drag action only when the target app exposes it; unsupported steps remain manual.",
          applicationIds: ["*"],
          triggers: ["stick figure", "Canva", "long YouTube", "video editing"],
          testCases: [
            { input: "Help me create a Canva video with stick figure animation and plan a long YouTube version.", shouldMatch: true },
            { input: "Explain how a bicycle gear works.", shouldMatch: false }
          ]
        })
      });
      skillDraft = draft.skill;
      const validated = await api("/api/skills/" + encodeURIComponent(skillDraft.id) + "/validate", {
        method: "POST", body: JSON.stringify({})
      });
      skillDraft = validated.skill;
      $("creator-skill-approve").classList.remove("hidden");
      status(validated.validation?.passed
        ? "Creator Studio skill draft passed its trigger tests. Review it, then explicitly activate it below or from Memory → Learning & Skills."
        : "Creator Studio skill draft was created, but some tests failed. Edit it in Memory → Learning & Skills before activation.");
    } catch (error) {
      status(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async function approveSkill() {
    if (!skillDraft?.id) return;
    const button = $("creator-skill-approve");
    button.disabled = true;
    try {
      const result = await api("/api/skills/" + encodeURIComponent(skillDraft.id) + "/approve", {
        method: "POST", body: JSON.stringify({})
      });
      skillDraft = result.skill;
      button.classList.add("hidden");
      toast("Creator Studio skill activated.");
      status("Creator Studio skill is approved and active for future matching JARVIS conversations.");
    } catch (error) {
      status(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function formatVideoDuration(value) {
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  function analyticsWindowDays() {
    return Number($("creator-analytics-days")?.value) || 28;
  }

  function setAnalyticsStatus(message, error = false) {
    const target = $("creator-channel-analytics-status");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("error-text", error);
  }

  async function loadAnalyticsStatus() {
    try {
      const result = await api("/api/youtube/analytics/status");
      const connect = $("creator-connect-analytics");
      const refresh = $("creator-refresh-analytics");
      if (connect) {
        connect.textContent = result.connected ? "YouTube Analytics connected · read-only" : "Connect read-only YouTube Analytics";
        connect.disabled = !result.canConnect || result.disabled || result.connected;
      }
      if (refresh) refresh.disabled = !result.connected;
      setAnalyticsStatus(result.connected
        ? "Read-only channel analytics is connected. JARVIS can read video performance and audience-retention reports; it cannot edit or publish videos with this permission."
        : result.disabled
          ? "Google services are disabled in JARVIS. Enable Google services before connecting YouTube Analytics."
          : result.canConnect
            ? "Connect a separate read-only YouTube permission to load channel reports. This does not grant upload or editing access."
            : "Google OAuth and the encrypted token vault must be configured on the JARVIS server before a read-only analytics connection can start.");
      if (result.connected) {
        $("creator-refresh-analytics").disabled = false;
      }
      return result;
    } catch (error) {
      setAnalyticsStatus(error.message || "Analytics connection status is unavailable.", true);
      return null;
    }
  }

  async function connectYouTubeAnalytics() {
    const button = $("creator-connect-analytics");
    button.disabled = true;
    try {
      const result = await api("/api/integrations/google_drive/oauth/start", {
        method: "POST",
        body: JSON.stringify({ capability: "youtube_analytics" })
      });
      if (!result.launchUrl) throw new Error("JARVIS did not return a Google consent link.");
      window.location.href = result.launchUrl;
    } catch (error) {
      setAnalyticsStatus(error.message, true);
      button.disabled = false;
    }
  }

  function renderTopVideos(report) {
    const target = $("creator-top-videos");
    if (!target) return;
    target.replaceChildren();
    const summary = document.createElement("p");
    summary.className = "small muted";
    summary.textContent = "Complete days: " + report.range.startDate + " through " + report.range.endDate +
      " · " + report.items.length + " videos returned";
    target.append(summary);
    if (!report.items.length) {
      target.append(makeAnalyticsEmpty("No video rows were returned for this date window. Try a longer period or check whether the channel has reportable views."));
      return;
    }
    for (const item of report.items) {
      const card = document.createElement("article");
      card.className = "creator-analytics-video";
      const title = document.createElement("a");
      title.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(item.videoId);
      title.target = "_blank";
      title.rel = "noopener noreferrer";
      title.textContent = "Open video · " + item.videoId;
      const metrics = document.createElement("p");
      metrics.className = "small muted";
      metrics.textContent = [
        Number(item.views).toLocaleString() + " views",
        (Number(item.estimatedMinutesWatched) / 60).toFixed(1) + " watch hours",
        formatVideoDuration(item.averageViewDurationSeconds) + " avg view duration",
        Number(item.averageViewPercentage).toFixed(1) + "% avg viewed",
        Number(item.likes).toLocaleString() + " likes",
        Number(item.comments).toLocaleString() + " comments",
        Number(item.subscribersGained).toLocaleString() + " subscribers gained"
      ].join(" · ");
      const retention = document.createElement("button");
      retention.type = "button";
      retention.className = "item-action";
      retention.textContent = "Inspect audience retention";
      retention.addEventListener("click", () => loadVideoRetention(item.videoId, retention));
      card.append(title, metrics, retention);
      target.append(card);
    }
  }

  function makeAnalyticsEmpty(message) {
    const item = document.createElement("p");
    item.className = "small muted";
    item.textContent = message;
    return item;
  }

  async function loadYouTubeAnalytics() {
    const button = $("creator-refresh-analytics");
    button.disabled = true;
    setAnalyticsStatus("Loading read-only YouTube reports…");
    try {
      const report = await api("/api/youtube/analytics?days=" + encodeURIComponent(analyticsWindowDays()));
      renderTopVideos(report);
      $("creator-retention-details").replaceChildren(
        makeAnalyticsEmpty("Choose a video above to inspect its audience-retention curve.")
      );
      setAnalyticsStatus("Loaded read-only reports for " + report.range.startDate + " through " + report.range.endDate + ". CTR is provided separately in YouTube Studio and can be entered in the comparison worksheet.");
    } catch (error) {
      setAnalyticsStatus(error.message || "YouTube Analytics could not load.", true);
    } finally {
      button.disabled = false;
    }
  }

  async function loadVideoRetention(videoId, button) {
    const target = $("creator-retention-details");
    target.replaceChildren(makeAnalyticsEmpty("Loading audience retention for " + videoId + "…"));
    if (button) button.disabled = true;
    try {
      const report = await api("/api/youtube/analytics/" + encodeURIComponent(videoId) +
        "/retention?days=" + encodeURIComponent(analyticsWindowDays()));
      target.replaceChildren();
      const heading = document.createElement("h3");
      heading.textContent = "Audience retention · " + report.videoId;
      const range = document.createElement("p");
      range.className = "small muted";
      range.textContent = "Complete days: " + report.range.startDate + " through " + report.range.endDate +
        ". Relative performance compares this video with videos of similar length.";
      target.append(heading, range);
      if (!report.items.length) {
        target.append(makeAnalyticsEmpty("No retention segments were returned for this video and period."));
        return;
      }
      for (const segment of report.items) {
        const row = document.createElement("div");
        row.className = "creator-retention-row";
        const label = document.createElement("span");
        label.textContent = Math.round(segment.elapsedVideoTimeRatio * 100) + "% of video";
        const bar = document.createElement("div");
        bar.className = "creator-retention-track";
        const fill = document.createElement("span");
        fill.style.width = Math.max(0, Math.min(100, segment.relativeRetentionPerformance * 100)) + "%";
        bar.append(fill);
        const value = document.createElement("span");
        value.className = "small muted";
        value.textContent = "Relative retention score " + segment.relativeRetentionPerformance.toFixed(2) +
          " (0.50 median) · audience-watch ratio " + segment.audienceWatchRatio.toFixed(2);
        row.append(label, bar, value);
        target.append(row);
      }
    } catch (error) {
      target.replaceChildren(makeAnalyticsEmpty(error.message || "Retention report could not be loaded."));
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setCanvaStatus(message, error = false) {
    const target = $("creator-canva-status");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("error-text", error);
  }

  async function loadCanvaStatus() {
    try {
      canvaStatus = await api("/api/canva/status");
      const connect = $("creator-connect-canva");
      const disconnect = $("creator-disconnect-canva");
      const thumbnail = $("creator-create-canva-thumbnail");
      const automationButtons = [
        "creator-canva-load-resources", "creator-canva-inspect-dataset",
        "creator-canva-run-autofill", "creator-canva-poll-autofill",
        "creator-canva-start-export", "creator-canva-poll-export"
      ];
      const ready = canvaStatus.automationReady === true;
      if (connect) {
        connect.textContent = ready
          ? "Canva automation connected"
          : canvaStatus.connected
            ? "Reconnect for full automation permissions"
            : "Connect Canva for automation";
        connect.disabled = !canvaStatus.canConnect;
      }
      if (disconnect) disconnect.classList.toggle("hidden", !canvaStatus.connected);
      if (thumbnail) thumbnail.disabled = !canvaStatus.connected;
      automationButtons.forEach((id) => {
        const button = $(id);
        if (button) button.disabled = !ready;
      });
      setCanvaStatus(ready
        ? "Canva is connected for design and brand-template discovery, template-field autofill, supported template updates and design exports. Pro/Teams/Enterprise features depend on your Canva plan."
        : canvaStatus.connected
          ? "Your older Canva connection is still saved, but it only has thumbnail permissions. Reconnect and approve the expanded design, template and export scopes to enable automation."
          : canvaStatus.canConnect
            ? "Canva is ready to connect. Approve the requested design, template and export permissions in Canva. Basic Android app control does not require OAuth."
            : "Canva Connect is not configured on the JARVIS server. Basic Android accessibility control can still open the installed Canva app without OAuth.");
      return canvaStatus;
    } catch (error) {
      $("creator-connect-canva").disabled = true;
      [
        "creator-canva-load-resources", "creator-canva-inspect-dataset",
        "creator-canva-run-autofill", "creator-canva-poll-autofill",
        "creator-canva-start-export", "creator-canva-poll-export"
      ].forEach((id) => {
        const button = $(id);
        if (button) button.disabled = true;
      });
      setCanvaStatus(error.message || "Canva connection status is unavailable.", true);
      return null;
    }
  }

  async function disconnectCanva() {
    const button = $("creator-disconnect-canva");
    const confirmed = window.confirm(
      "Disconnect Canva from JARVIS? This will revoke the Canva refresh-token lineage and remove the stored connection. Existing Canva designs in your account will not be deleted."
    );
    if (!confirmed) return;
    button.disabled = true;
    try {
      await api("/api/integrations/canva/oauth/revoke", {
        method: "POST",
        body: JSON.stringify({})
      });
      $("creator-canva-design-link").classList.add("hidden");
      $("creator-canva-design-link").removeAttribute("href");
      await loadCanvaStatus();
      setCanvaStatus("Canva was disconnected and its stored token was revoked. Existing Canva designs were not deleted.");
      toast("Canva disconnected.");
    } catch (error) {
      setCanvaStatus(error.message || "Canva could not be disconnected.", true);
      button.disabled = false;
    }
  }

  async function connectCanva() {
    const button = $("creator-connect-canva");
    button.disabled = true;
    try {
      const result = await api("/api/integrations/canva/oauth/start", {
        method: "POST",
        body: JSON.stringify({})
      });
      if (!result.authorizationUrl) throw new Error("JARVIS did not return a Canva consent URL.");
      window.location.href = result.authorizationUrl;
    } catch (error) {
      setCanvaStatus(error.message || "Canva connection could not start.", true);
      button.disabled = false;
    }
  }

  async function createCanvaThumbnailDesign() {
    const button = $("creator-create-canva-thumbnail");
    button.disabled = true;
    try {
      const confirmed = window.confirm(
        "Upload the current 1280 × 720 PNG to your connected Canva account and create a new design? " +
        "This creates a new Canva design; it does not publish a video. The image will be a single flat object."
      );
      if (!confirmed) return;
      const canvas = $("creator-thumbnail-canvas");
      const png = await canvasToPng(canvas);
      const title = clean($("creator-thumbnail-title").value || plan?.topic || "JARVIS YouTube Thumbnail", 50);
      const response = await api("/api/canva/thumbnail-design", {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-Jarvis-Asset-Name": encodeURIComponent(title)
        },
        body: png
      });
      const design = response.design;
      const link = $("creator-canva-design-link");
      link.href = design.editUrl;
      link.textContent = "Open Canva design · " + (design.title || title);
      link.classList.remove("hidden");
      setCanvaStatus("Created a 16:9 Canva design. The uploaded thumbnail is one flat image, not separate editable text and shape layers. Canva's edit link is temporary; open it and make your changes there.");
      toast("Canva thumbnail design created.");
    } catch (error) {
      setCanvaStatus(error.message || "Canva could not create this design.", true);
    } finally {
      button.disabled = !canvaStatus?.connected;
    }
  }


  function canvaResultItems(payload, kind) {
    const job = payload?.job || payload;
    if (Array.isArray(job?.items)) return job.items;
    if (Array.isArray(job?.designs)) return job.designs;
    if (Array.isArray(job?.brand_templates)) return job.brand_templates;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  }

  function safeCanvaLink(raw, allowDownload = false) {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:") return "";
      if (allowDownload) {
        return host === "canva.com" || host.endsWith(".canva.com") ? url.toString() : "";
      }
      return host === "www.canva.com" ? url.toString() : "";
    } catch {
      return "";
    }
  }

  function renderCanvaResources(items, kind) {
    const target = $("creator-canva-resources");
    if (!target) return;
    target.replaceChildren();
    if (!items.length) {
      const note = document.createElement("p");
      note.className = "small muted";
      note.textContent = "No resources were returned. Try another search, check your Canva permissions or check whether your Canva plan exposes brand templates.";
      target.append(note);
      return;
    }
    items.forEach((item) => {
      const id = String(item?.id || item?.design?.id || "").slice(0, 128);
      if (!id) return;
      const title = String(item?.title || item?.name || "Untitled Canva resource").slice(0, 160);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item-action";
      button.textContent = title + " · " + id;
      button.addEventListener("click", () => {
        $("creator-canva-resource-id").value = id;
        $("creator-canva-source").value = kind === "templates" ? "brand_template" : "design";
        setCanvaStatus("Selected " + title + ". Inspect its editable data fields before autofilling.");
      });
      target.append(button);
    });
  }

  async function loadCanvaResources() {
    const button = $("creator-canva-load-resources");
    button.disabled = true;
    try {
      const kind = $("creator-canva-resource-kind").value;
      const query = $("creator-canva-search").value.trim();
      const endpoint = kind === "templates" ? "/api/canva/brand-templates" : "/api/canva/designs";
      const payload = await api(endpoint + "?query=" + encodeURIComponent(query) + "&limit=20");
      const items = canvaResultItems(payload, kind);
      renderCanvaResources(items, kind);
      const count = items.length;
      setCanvaStatus("Loaded " + count + " Canva " + (kind === "templates" ? "brand template" : "design") + " result(s). Select one to fill its ID.");
    } catch (error) {
      setCanvaStatus(error.message || "Canva resources could not be loaded.", true);
    } finally {
      button.disabled = !canvaStatus?.automationReady;
    }
  }

  function fieldValueTemplate(field) {
    const type = String(field?.type || field?.value_type || field?.field_type || "text").toLowerCase();
    if (type.includes("image")) return { type: "image", asset_id: "REPLACE_WITH_CANVA_ASSET_ID" };
    if (type.includes("video")) return { type: "video", asset_id: "REPLACE_WITH_CANVA_ASSET_ID" };
    if (type.includes("chart")) return { type: "chart", chart_data: {} };
    if (type.includes("sheet")) return { type: "sheet", sheet_data: {} };
    return { type: "text", text: "" };
  }

  async function inspectCanvaDataset() {
    const button = $("creator-canva-inspect-dataset");
    const source = $("creator-canva-source").value;
    const id = $("creator-canva-resource-id").value.trim();
    if (!id) return setCanvaStatus("Select or enter a Canva template/design ID first.", true);
    button.disabled = true;
    try {
      const endpoint = source === "brand_template"
        ? "/api/canva/brand-templates/" + encodeURIComponent(id) + "/dataset"
        : "/api/canva/designs/" + encodeURIComponent(id) + "/dataset";
      const payload = await api(endpoint);
      $("creator-canva-dataset").textContent = JSON.stringify(payload, null, 2);
      const fields = payload?.dataset?.fields || payload?.fields || payload?.dataset?.data_fields;
      if (Array.isArray(fields) && fields.length) {
        const mapping = {};
        fields.forEach((field) => {
          const name = String(field?.name || field?.label || field?.id || "").trim();
          if (name) mapping[name] = fieldValueTemplate(field);
        });
        if (Object.keys(mapping).length) {
          $("creator-canva-data-json").value = JSON.stringify(mapping, null, 2);
        }
      }
      setCanvaStatus("Dataset loaded. Review the exact field names and replace sample text/asset IDs before running autofill.");
    } catch (error) {
      setCanvaStatus(error.message || "Canva dataset could not be inspected.", true);
    } finally {
      button.disabled = !canvaStatus?.automationReady;
    }
  }

  function findAutofillDesign(job) {
    const candidates = [
      job?.result?.design, job?.result?.designs?.[0], job?.design,
      job?.result?.created_design, job?.result?.updated_design
    ];
    return candidates.find((item) => item && (item.id || item.urls?.edit_url)) || null;
  }

  async function pollCanvaAutofill() {
    const id = $("creator-canva-autofill-job").value.trim();
    if (!id) return setCanvaStatus("Enter an autofill job ID to check its status.", true);
    const button = $("creator-canva-poll-autofill");
    button.disabled = true;
    try {
      const payload = await api("/api/canva/autofills/" + encodeURIComponent(id));
      const job = payload?.job || payload;
      $("creator-canva-dataset").textContent = JSON.stringify(payload, null, 2);
      const design = findAutofillDesign(job);
      const editUrl = safeCanvaLink(design?.urls?.edit_url || design?.edit_url);
      if (design?.id) {
        $("creator-canva-resource-id").value = String(design.id).slice(0, 128);
        $("creator-canva-source").value = "update_design";
      }
      if (editUrl) {
        const link = $("creator-canva-design-link");
        link.href = editUrl;
        link.textContent = "Open Canva design · " + String(design?.title || design.id || "created");
        link.classList.remove("hidden");
      }
      const status = String(job?.status || "unknown");
      setCanvaStatus("Canva autofill job: " + status + (design?.id ? " · design ID " + design.id : "") +
        (status === "in_progress" ? " · check again shortly" : ""));
    } catch (error) {
      setCanvaStatus(error.message || "Autofill job could not be checked.", true);
    } finally {
      button.disabled = !canvaStatus?.automationReady;
    }
  }

  async function runCanvaAutofill() {
    const button = $("creator-canva-run-autofill");
    const source = $("creator-canva-source").value;
    const id = $("creator-canva-resource-id").value.trim();
    if (!id) return setCanvaStatus("Choose a Canva template/design ID first.", true);
    let data;
    try {
      data = JSON.parse($("creator-canva-data-json").value);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Expected a JSON object.");
    } catch (error) {
      return setCanvaStatus("Field values are not valid JSON: " + error.message, true);
    }
    const title = $("creator-canva-title").value.trim();
    const actionName = source === "update_design" ? "update the selected Canva design" : "create a new Canva design";
    if (!window.confirm("JARVIS will " + actionName + " using the selected Canva fields. This changes your Canva account. Continue only after reviewing the field data.")) return;
    button.disabled = true;
    try {
      const payload = await api("/api/canva/autofills", {
        method: "POST",
        body: JSON.stringify({ source, id, title, data })
      });
      const job = payload?.job || payload;
      const jobId = String(job?.id || "").slice(0, 128);
      if (!jobId) throw new Error("Canva did not return an autofill job ID.");
      $("creator-canva-autofill-job").value = jobId;
      $("creator-canva-dataset").textContent = JSON.stringify(payload, null, 2);
      setCanvaStatus("Autofill job submitted to Canva (" + String(job.status || "queued") + "). Check the job status to retrieve the result.");
    } catch (error) {
      setCanvaStatus(error.message || "Canva autofill could not be submitted.", true);
    } finally {
      button.disabled = !canvaStatus?.automationReady;
    }
  }

  async function startCanvaExport() {
    const button = $("creator-canva-start-export");
    const designId = $("creator-canva-resource-id").value.trim();
    const format = $("creator-canva-export-format").value;
    if (!designId) return setCanvaStatus("Select a design ID before exporting. A template ID alone is not an exportable design.", true);
    if (!window.confirm("Export Canva design " + designId + " as " + format.toUpperCase() + "? Canva may take time to render the file. Continue?")) return;
    button.disabled = true;
    try {
      const payload = await api("/api/canva/exports", {
        method: "POST",
        body: JSON.stringify({ designId, format })
      });
      const job = payload?.job || payload;
      const jobId = String(job?.id || "").slice(0, 128);
      if (!jobId) throw new Error("Canva did not return an export job ID.");
      $("creator-canva-export-job").value = jobId;
      $("creator-canva-dataset").textContent = JSON.stringify(payload, null, 2);
      setCanvaStatus("Canva export job submitted (" + String(job.status || "queued") + "). Poll the job to obtain the temporary download URL.");
    } catch (error) {
      setCanvaStatus(error.message || "Canva export could not be started.", true);
    } finally {
      button.disabled = !canvaStatus?.automationReady;
    }
  }

  async function pollCanvaExport() {
    const id = $("creator-canva-export-job").value.trim();
    if (!id) return setCanvaStatus("Enter an export job ID to check its status.", true);
    const button = $("creator-canva-poll-export");
    button.disabled = true;
    try {
      const payload = await api("/api/canva/exports/" + encodeURIComponent(id));
      const job = payload?.job || payload;
      $("creator-canva-dataset").textContent = JSON.stringify(payload, null, 2);
      const urls = Array.isArray(job?.urls) ? job.urls : [];
      const first = urls.map((item) => typeof item === "string" ? item : item?.url)
        .map((url) => safeCanvaLink(url, true)).find(Boolean);
      if (first) {
        const link = $("creator-canva-download-link");
        link.href = first;
        link.classList.remove("hidden");
        link.textContent = "Open completed " + $("creator-canva-export-format").value.toUpperCase() + " export";
      }
      setCanvaStatus("Canva export job: " + String(job?.status || "unknown") +
        (first ? " · download link ready (temporary; save the file soon)" : " · poll again when rendering is in progress"));
    } catch (error) {
      setCanvaStatus(error.message || "Canva export job could not be checked.", true);
    } finally {
      button.disabled = !canvaStatus?.automationReady;
    }
  }

  function setAnalyticsAdvice() {
    const baselineCtr = Number($("creator-baseline-ctr").value);
    const currentCtr = Number($("creator-current-ctr").value);
    const baselineIntro = Number($("creator-intro-baseline").value);
    const currentIntro = Number($("creator-intro-retention").value);
    const notes = [];
    const hasCtr = $("creator-baseline-ctr").value && $("creator-current-ctr").value;
    const hasIntro = $("creator-intro-baseline").value && $("creator-intro-retention").value;
    if (hasCtr && Number.isFinite(baselineCtr) && Number.isFinite(currentCtr)) {
      notes.push(currentCtr < baselineCtr
        ? "CTR is below your comparable-video baseline. Check whether the title and thumbnail clearly communicate the video's real benefit. Change one packaging element at a time and compare similar traffic sources."
        : "CTR is at or above your comparable-video baseline. Check retention next to see whether the opening delivers what the title and thumbnail promise.");
    } else {
      notes.push("Enter this video's CTR and the median from similar videos on your own channel. Compare similar traffic sources and time windows.");
    }
    if (hasIntro && Number.isFinite(baselineIntro) && Number.isFinite(currentIntro)) {
      notes.push(currentIntro < baselineIntro
        ? "More viewers are leaving before 0:30 than in your comparable videos. Review the first seconds for slow setup, unclear context or a mismatch with the title/thumbnail promise."
        : "Opening retention is at or above your comparable-video baseline. Inspect later dips and rewatch spikes to find where the explanation could be clearer.");
    } else {
      notes.push("Enter this video's 0:30 retention and the median from similar videos to assess the opening. There is no universal retention percentage that guarantees reach.");
    }
    notes.push("These are diagnostic prompts, not a prediction of reach. Compare like-for-like videos; YouTube recommendations are personalized around viewer interest and satisfaction.");
    $("creator-analytics-advice").textContent = notes.join("\n\n");
  }

  function init() {
    if ($("creator-form")?.dataset.initialized === "true") return;
    if (!$("creator-form")) return;
    $("creator-form").dataset.initialized = "true";
    restore();
    $("creator-form").addEventListener("submit", generatePlan);
    $("creator-write-script").addEventListener("click", writeFullScript);
    $("creator-export-script").addEventListener("click", exportScript);
    $("creator-export-csv").addEventListener("click", exportCsv);
    $("creator-export-description").addEventListener("click", exportDescription);
    $("creator-pose").addEventListener("change", () => { renderFigure(); renderCreatorCanvases(); });
    $("creator-export-figure").addEventListener("click", exportFigure);
    $("creator-export-poses").addEventListener("click", exportPoseSheet);
    $("creator-export-thumbnail").addEventListener("click", exportThumbnail);
    $("creator-export-motion").addEventListener("click", exportMotionSample);
    $("creator-connect-canva").addEventListener("click", connectCanva);
    $("creator-disconnect-canva").addEventListener("click", disconnectCanva);
    $("creator-create-canva-thumbnail").addEventListener("click", createCanvaThumbnailDesign);
    $("creator-canva-load-resources").addEventListener("click", loadCanvaResources);
    $("creator-canva-inspect-dataset").addEventListener("click", inspectCanvaDataset);
    $("creator-canva-run-autofill").addEventListener("click", runCanvaAutofill);
    $("creator-canva-poll-autofill").addEventListener("click", pollCanvaAutofill);
    $("creator-canva-start-export").addEventListener("click", startCanvaExport);
    $("creator-canva-poll-export").addEventListener("click", pollCanvaExport);
    $("creator-canva-resource-kind").addEventListener("change", () => $("creator-canva-resources").replaceChildren());

    ["creator-thumbnail-title", "creator-thumbnail-subtitle"].forEach((id) => {
      $(id).addEventListener("input", () => { renderCreatorCanvases(); persist(); });
    });
    $("creator-skill-create").addEventListener("click", createSkill);
    $("creator-skill-approve").addEventListener("click", approveSkill);
    $("creator-analytics-check").addEventListener("click", setAnalyticsAdvice);
    $("creator-connect-analytics").addEventListener("click", connectYouTubeAnalytics);
    $("creator-refresh-analytics").addEventListener("click", loadYouTubeAnalytics);
    $("creator-full-script").addEventListener("input", () => {
      fullScript = $("creator-full-script").value;
      persist();
    });
    ["creator-topic", "creator-audience", "creator-language", "creator-duration"].forEach((id) => {
      $(id).addEventListener("change", persist);
    });
    renderFigure();
    renderCreatorCanvases();
    loadCanvaStatus();
    status("Creator Studio ready. Drafts stay in this browser until you export them.");
  }

  return { init, renderFigure, loadAnalyticsStatus, loadCanvaStatus };
}
