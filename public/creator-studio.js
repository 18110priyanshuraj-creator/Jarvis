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

function makePoseSheet() {
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
          instructions: "Help plan and improve original educational or general-audience videos. Start with audience, specific viewer question, promise, platform, language and duration. Create truthful hooks, clear title and thumbnail concepts, long-form chapter outline, natural narration, shot list, on-screen text, captions and a storyboard. For stick figures, use a consistent circle head, torso and separate limb lines, with a reusable pose library. Explain how to build the design in Canva using its timeline, tracks, audio, captions, transitions and export, but do not claim to control unsupported drag-and-drop or detailed timeline controls. Use Creator Studio exports for scripts, storyboard CSV, YouTube description and SVG character assets. Suggest reviewing YouTube Analytics (impressions, CTR, first 30-second retention, average view duration and dips) against the channel's own comparable videos. Never promise viral views or 100% reach; never fabricate stats or sources. Keep the owner in control of media rights, final file selection, privacy/audience declarations and publishing. Device control is limited to the exact accessible app actions already supported by Android Companion.",
          applicationIds: ["*"],
          triggers: ["stick figure", "Canva", "long YouTube", "video editing"],
          testCases: [
            { input: "Help me make a stick figure explainer video in Canva and plan a long YouTube version.", shouldMatch: true },
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

  function setAnalyticsAdvice() {
    const ownMedian = Number($("creator-baseline-ctr").value);
    const currentCtr = Number($("creator-current-ctr").value);
    const intro = Number($("creator-intro-retention").value);
    const notes = [];
    if (Number.isFinite(ownMedian) && Number.isFinite(currentCtr) && $("creator-baseline-ctr").value && $("creator-current-ctr").value) {
      if (currentCtr < ownMedian) notes.push("CTR is below the channel baseline you entered. Try a clearer, more specific title or a simpler thumbnail; change one variable at a time.");
      else notes.push("CTR is at or above the channel baseline you entered. Keep the packaging, then inspect retention to find the next improvement.");
    } else {
      notes.push("Enter this video's CTR and your own comparable-video median CTR to make a useful packaging comparison.");
    }
    if (Number.isFinite(intro) && $("creator-intro-retention").value) {
      if (intro < 50) notes.push("A large share of viewers are not reaching the end of the first 30 seconds. Review the opening promise, remove slow setup and show the payoff earlier.");
      else notes.push("The first 30 seconds appear to be holding a reasonable share of viewers for this example. Inspect later dips and compare with similar videos.");
    } else {
      notes.push("Add the first-30-second retention value from YouTube Studio to diagnose the opening.");
    }
    notes.push("These are diagnostic prompts, not universal benchmarks or a prediction of reach. Compare like-for-like videos and traffic sources.");
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
    $("creator-pose").addEventListener("change", renderFigure);
    $("creator-export-figure").addEventListener("click", exportFigure);
    $("creator-export-poses").addEventListener("click", exportPoseSheet);
    $("creator-skill-create").addEventListener("click", createSkill);
    $("creator-skill-approve").addEventListener("click", approveSkill);
    $("creator-analytics-check").addEventListener("click", setAnalyticsAdvice);
    $("creator-full-script").addEventListener("input", () => {
      fullScript = $("creator-full-script").value;
      persist();
    });
    ["creator-topic", "creator-audience", "creator-language", "creator-duration"].forEach((id) => {
      $(id).addEventListener("change", persist);
    });
    $("creator-open-canva").addEventListener("click", () => {
      window.open("https://www.canva.com/create/videos/", "_blank", "noopener,noreferrer");
    });
    renderFigure();
    status("Creator Studio ready. Drafts stay in this browser until you export them.");
  }

  return { init, renderFigure };
}
