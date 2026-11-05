import {
  buildCreatorAssetFiles,
  buildCreatorCaptions,
  buildCreatorStoryboardCsv,
  buildStoredZip,
  buildYouTubeChapters
} from "./creator-campaign-assets.js";

const $ = id => document.getElementById(id);

function node(tag, className, value) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (value !== undefined) item.textContent = String(value);
  return item;
}

function add(parent, tag, className, value) {
  const item = node(tag, className, value);
  parent.append(item);
  return item;
}

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function safeName(value) {
  return String(value || "jarvis-campaign").normalize("NFKD")
    .replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 70).toLowerCase() || "jarvis-campaign";
}

function download(name, value, type) {
  const blob = new Blob([value], { type });
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

function markdown(pack) {
  const lines = [
    "# " + pack.title, "", "Topic: " + pack.topic, "Audience: " + pack.audience,
    "Language: " + pack.language, "", "## Trend Radar · 24 hours",
    pack.trendRadar.summary || "No trend summary."
  ];
  for (const source of pack.trendRadar.sources || []) {
    const url = safeHttps(source.url);
    if (url) lines.push("- [" + source.title + "](" + url + ")");
  }
  lines.push("", "## Short video", "Hook: " + pack.shortVideo.hook, "");
  for (const scene of pack.shortVideo.scenes) {
    lines.push("### " + scene.heading, scene.voiceover, "On-screen: " + scene.onScreenText,
      "Visual: " + scene.visualPrompt, "Duration: " + scene.durationSeconds + "s", "");
  }
  lines.push("## Carousel");
  for (const slide of pack.carousel.slides) lines.push("### " + slide.heading, slide.body, "Visual: " + slide.visualPrompt, "");
  lines.push("## SEO page", "Slug: " + pack.seoPage.slug,
    "Meta title: " + pack.seoPage.metaTitle, "Meta description: " + pack.seoPage.metaDescription,
    "# " + pack.seoPage.h1);
  for (const section of pack.seoPage.sections) lines.push("## " + section.heading, section.summary, "");
  lines.push("## FAQs");
  for (const faq of pack.seoPage.faqs) lines.push("**" + faq.question + "**", faq.answer, "");
  for (const draft of pack.socialDrafts) {
    lines.push("## " + draft.platform, draft.caption, draft.cta,
      draft.hashtags.map(tag => "#" + tag).join(" "), "");
  }
  lines.push("## Lead magnet", "### " + pack.leadMagnet.title, pack.leadMagnet.promise,
    ...pack.leadMagnet.sections.map(item => "- " + item), pack.leadMagnet.cta, "",
    "## Lead reply kit · manual drafts only", "Comment keyword: " + pack.leadMachine.commentKeyword,
    "Public reply: " + pack.leadMachine.publicReplyDraft,
    "Manual resource reply: " + pack.leadMachine.manualReplyDraft,
    "Follow-up boundary: " + pack.leadMachine.followUpRule, "",
    "## Follow-up ideas", ...pack.ideas.map(item => "- " + item), "",
    "Review claims, source links and media rights before publishing.");
  return lines.join("\n");
}

function readinessChecks(pack) {
  const scenes = pack.shortVideo?.scenes || [];
  const slides = pack.carousel?.slides || [];
  const platforms = new Set((pack.socialDrafts || []).map(item => item.platform));
  const sourcesReady = Boolean(pack.sourceNotesProvided || pack.trendRadar?.sources?.length);
  return [
    { label: "Source material attached", ready: sourcesReady, detail: sourcesReady ? "Source notes or trend links are present." : "Add reviewed notes or verify reliable sources before publishing." },
    { label: "Opening hook", ready: (pack.shortVideo?.hook || "").trim().length >= 28, detail: "The first line should make the topic and viewer benefit clear." },
    { label: "Narration plan", ready: scenes.length >= 3 && scenes.every(item => (item.voiceover || "").trim().length >= 15), detail: "At least three scenes have narration." },
    { label: "Carousel readability", ready: slides.length >= 4 && slides.every(item => item.body && item.body.length <= 240), detail: "Four or more slides with concise body copy." },
    { label: "SEO metadata", ready: (pack.seoPage?.metaTitle || "").length > 0 && (pack.seoPage?.metaTitle || "").length <= 60 && (pack.seoPage?.metaDescription || "").length > 0 && (pack.seoPage?.metaDescription || "").length <= 155 && Boolean(pack.seoPage?.slug), detail: "Title, description and slug fit the draft limits." },
    { label: "Platform drafts", ready: platforms.size === 3 && ["instagram", "youtube-shorts", "facebook"].every(item => platforms.has(item)), detail: "Instagram, YouTube Shorts and Facebook drafts are present." },
    { label: "Lead reply boundary", ready: Boolean(pack.leadMachine?.followUpRule && pack.leadMachine.followUpRule.length >= 24), detail: "Reply guidance is present; all outreach remains manual." }
  ];
}

export function createCreatorCampaignStudio({ api, toast }) {
  let current = null;
  let mediaProjectCreated = false;
  let loading = false;

  function setStatus(message, error = false) {
    const target = $("creator-campaign-status");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("error-text", error);
  }

  function card(parent, title, description) {
    const section = add(parent, "section", "creator-campaign-card");
    add(section, "h3", "", title);
    if (description) add(section, "p", "small muted", description);
    return section;
  }

  function editorField(parent, labelText, value, field, index, rows = 2, maxLength = 1600) {
    const wrapper = add(parent, "label", "creator-campaign-editor-field");
    add(wrapper, "span", "small muted", labelText);
    const textarea = add(wrapper, "textarea", "");
    textarea.value = String(value ?? "");
    textarea.rows = rows;
    textarea.maxLength = maxLength;
    textarea.dataset.campaignField = field;
    if (index !== undefined) textarea.dataset.index = String(index);
    return textarea;
  }

  function fieldValue(field, index) {
    const controls = Array.from($("creator-campaign-results").querySelectorAll("[data-campaign-field]"));
    const match = controls.find(control => control.dataset.campaignField === field &&
      (index === undefined ? control.dataset.index === undefined : control.dataset.index === String(index)));
    return match ? match.value : "";
  }

  function renderHistory(items) {
    const target = $("creator-campaign-history");
    if (!target) return;
    target.replaceChildren();
    if (!items.length) {
      add(target, "p", "small muted", "Saved campaign drafts will appear here.");
      return;
    }
    for (const item of items.slice(0, 8)) {
      const button = add(target, "button", "item-action creator-campaign-history-item", item.title || item.topic);
      button.type = "button";
      button.addEventListener("click", () => render(item));
    }
  }

  async function loadHistory() {
    try {
      const result = await api("/api/creator/campaigns");
      renderHistory(result.campaigns || []);
    } catch {
      renderHistory([]);
    }
  }

  function render(pack) {
    current = pack;
    mediaProjectCreated = false;
    const target = $("creator-campaign-results");
    const actions = $("creator-campaign-actions");
    if (!target || !actions) return;
    target.replaceChildren();
    actions.classList.remove("hidden");
    $("creator-campaign-results-wrap").classList.remove("hidden");

    const heading = card(target, pack.title, "Draft pack · revision " + (pack.revision || 1) + " · " + pack.engine + " · " + pack.language);
    add(heading, "p", "small muted", "Topic: " + pack.topic + " · Audience: " + pack.audience);
    editorField(heading, "Campaign title", pack.title, "title", undefined, 1, 90);
    const brand = pack.brandKit || {};
    $("creator-campaign-brand-name").value = brand.brandName || "";
    $("creator-campaign-accent").value = brand.accentColor || "#1fc7d4";
    $("creator-campaign-background").value = brand.backgroundColor || "#071a24";
    $("creator-campaign-text").value = brand.textColor || "#f2fbff";

    const checks = readinessChecks(pack);
    const readyCount = checks.filter(item => item.ready).length;
    const review = card(target, "Pre-publish structure check · " + readyCount + "/" + checks.length, "Automated completeness checks only. This does not verify factual accuracy, image rights or platform compliance.");
    const checkList = add(review, "ul", "creator-campaign-checklist");
    for (const item of checks) {
      const row = add(checkList, "li", item.ready ? "is-ready" : "needs-review");
      add(row, "strong", "", (item.ready ? "✓ " : "Review · ") + item.label);
      add(row, "span", "small muted", item.detail);
    }
    add(review, "p", "small muted", "Before publishing: verify factual claims against primary sources, check image/audio licences, review captions and preview the final export.");

    const trend = card(target, "Trend Radar · last 24 hours", pack.trendRadar.status);
    add(trend, "p", "", pack.trendRadar.summary || "No trend summary.");
    if (pack.trendRadar.sources?.length) {
      const list = add(trend, "ul", "creator-campaign-list");
      for (const source of pack.trendRadar.sources) {
        const li = add(list, "li", "");
        const href = safeHttps(source.url);
        if (href) {
          const anchor = add(li, "a", "", source.title || href);
          anchor.href = href;
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
        } else {
          li.textContent = source.title || "Source link unavailable";
        }
        if (source.publishedAt) add(li, "span", "small muted", " · " + source.publishedAt);
      }
    }

    const video = card(target, "Short video · " + pack.shortVideo.durationSeconds + "s", "Edit your hook, narration and screen copy before sending this draft to Media Studio.");
    editorField(video, "Video title", pack.shortVideo.title, "shortVideo.title", undefined, 1, 90);
    editorField(video, "Opening hook", pack.shortVideo.hook, "shortVideo.hook", undefined, 2, 320);
    editorField(video, "Video caption", pack.shortVideo.caption, "shortVideo.caption", undefined, 3, 1500);
    for (const [index, scene] of pack.shortVideo.scenes.entries()) {
      const item = add(video, "article", "creator-campaign-scene");
      add(item, "strong", "", (index + 1) + ". Scene · " + scene.durationSeconds + "s");
      editorField(item, "Scene heading", scene.heading, "scene.heading", index, 1, 90);
      editorField(item, "Voiceover", scene.voiceover, "scene.voiceover", index, 3, 900);
      editorField(item, "On-screen text", scene.onScreenText, "scene.onScreenText", index, 2, 120);
      editorField(item, "Visual direction", scene.visualPrompt, "scene.visualPrompt", index, 2, 360);
    }

    const carousel = card(target, "Instagram carousel · " + pack.carousel.slides.length + " slides", "Each slide is editable and also exported as a separate 1080×1080 SVG.");
    editorField(carousel, "Carousel title", pack.carousel.title, "carousel.title", undefined, 1, 90);
    editorField(carousel, "Carousel caption", pack.carousel.caption, "carousel.caption", undefined, 2, 1500);
    for (const [index, slide] of pack.carousel.slides.entries()) {
      const item = add(carousel, "article", "creator-campaign-slide");
      add(item, "strong", "", "Slide " + (index + 1));
      editorField(item, "Slide heading", slide.heading, "slide.heading", index, 1, 90);
      editorField(item, "Slide body", slide.body, "slide.body", index, 3, 360);
      editorField(item, "Visual direction", slide.visualPrompt, "slide.visualPrompt", index, 2, 300);
    }
    editorField(carousel, "Comment CTA", pack.carousel.commentCTA, "carousel.commentCTA", undefined, 2, 260);

    const seo = card(target, "SEO page draft", "Slug: /" + pack.seoPage.slug);
    editorField(seo, "Meta title", pack.seoPage.metaTitle, "seo.metaTitle", undefined, 1, 60);
    editorField(seo, "Meta description", pack.seoPage.metaDescription, "seo.metaDescription", undefined, 2, 155);
    editorField(seo, "Page H1", pack.seoPage.h1, "seo.h1", undefined, 1, 120);
    for (const section of pack.seoPage.sections) {
      add(seo, "strong", "", section.heading);
      add(seo, "p", "", section.summary);
    }
    if (pack.seoPage.faqs.length) {
      add(seo, "h4", "", "FAQs");
      for (const faq of pack.seoPage.faqs) {
        add(seo, "strong", "", faq.question);
        add(seo, "p", "", faq.answer);
      }
    }

    for (const draft of pack.socialDrafts) {
      const social = card(target, draft.platform + " draft");
      editorField(social, "Caption", draft.caption, "social.caption", pack.socialDrafts.indexOf(draft), 3, 1500);
      editorField(social, "Call to action", draft.cta, "social.cta", pack.socialDrafts.indexOf(draft), 2, 260);
      add(social, "p", "small muted", draft.hashtags.map(tag => "#" + tag).join(" "));
    }

    const lead = card(target, "Lead magnet outline", pack.leadMagnet.promise);
    add(lead, "h4", "", pack.leadMagnet.title);
    const leadList = add(lead, "ul", "creator-campaign-list");
    for (const line of pack.leadMagnet.sections) add(leadList, "li", "", line);
    add(lead, "p", "", pack.leadMagnet.cta);

    const leadMachine = card(target, "Lead reply kit · manual drafts only", "Comment-to-resource reply templates. Nothing is sent automatically.");
    add(leadMachine, "p", "", "Optional comment keyword: " + pack.leadMachine.commentKeyword);
    add(leadMachine, "p", "", "Public reply: " + pack.leadMachine.publicReplyDraft);
    add(leadMachine, "p", "", "Manual resource reply: " + pack.leadMachine.manualReplyDraft);
    add(leadMachine, "p", "small muted", "Boundary: " + pack.leadMachine.followUpRule);

    const ideas = card(target, "Next content ideas");
    const ideaList = add(ideas, "ol", "creator-campaign-list");
    for (const idea of pack.ideas) add(ideaList, "li", "", idea);

    if (pack.revisionHistory?.length) {
      const history = card(target, "Revision history", "Latest " + pack.revisionHistory.length + " previous saved revision(s).");
      for (const item of pack.revisionHistory) {
        add(history, "p", "small muted", "Revision " + item.revision + " · " + item.title + (item.updatedAt ? " · " + item.updatedAt : ""));
      }
    }
    $("creator-campaign-save-revision").disabled = false;
    setStatus(pack.generationNote || "Campaign draft is ready. Edit any fields and save a new revision when you are satisfied.");
    $("creator-campaign-export-json").disabled = false;
    $("creator-campaign-export-md").disabled = false;
    $("creator-campaign-export-assets").disabled = false;
    $("creator-campaign-export-srt").disabled = false;
    $("creator-campaign-export-vtt").disabled = false;
    $("creator-campaign-export-csv").disabled = false;
    $("creator-campaign-export-chapters").disabled = false;
    $("creator-campaign-to-media").disabled = false;
  }

  async function saveRevision() {
    if (!current || loading) return;
    loading = true;
    const button = $("creator-campaign-save-revision");
    button.disabled = true;
    setStatus("Saving edits as a new campaign revision…");
    try {
      const shortVideo = {
        ...current.shortVideo,
        title: fieldValue("shortVideo.title"),
        hook: fieldValue("shortVideo.hook"),
        caption: fieldValue("shortVideo.caption"),
        scenes: current.shortVideo.scenes.map((scene, index) => ({
          ...scene,
          heading: fieldValue("scene.heading", index),
          voiceover: fieldValue("scene.voiceover", index),
          onScreenText: fieldValue("scene.onScreenText", index),
          visualPrompt: fieldValue("scene.visualPrompt", index)
        }))
      };
      const carousel = {
        ...current.carousel,
        title: fieldValue("carousel.title"),
        caption: fieldValue("carousel.caption"),
        commentCTA: fieldValue("carousel.commentCTA"),
        slides: current.carousel.slides.map((slide, index) => ({
          ...slide,
          heading: fieldValue("slide.heading", index),
          body: fieldValue("slide.body", index),
          visualPrompt: fieldValue("slide.visualPrompt", index)
        }))
      };
      const seoPage = {
        ...current.seoPage,
        metaTitle: fieldValue("seo.metaTitle"),
        metaDescription: fieldValue("seo.metaDescription"),
        h1: fieldValue("seo.h1")
      };
      const socialDrafts = current.socialDrafts.map((draft, index) => ({
        ...draft,
        caption: fieldValue("social.caption", index),
        cta: fieldValue("social.cta", index)
      }));
      const brandKit = {
        brandName: $("creator-campaign-brand-name").value,
        accentColor: $("creator-campaign-accent").value,
        backgroundColor: $("creator-campaign-background").value,
        textColor: $("creator-campaign-text").value
      };
      const result = await api("/api/creator/campaigns/" + encodeURIComponent(current.id), {
        method: "PATCH",
        body: JSON.stringify({
          title: fieldValue("title"), shortVideo, carousel, seoPage, socialDrafts, brandKit
        })
      });
      render(result.campaign);
      await loadHistory();
      toast("Saved campaign revision " + result.campaign.revision + ".");
    } catch (error) {
      setStatus(error.message || "Campaign revision could not be saved.", true);
      toast(error.message || "Campaign revision could not be saved.", true);
    } finally {
      loading = false;
      button.disabled = false;
    }
  }

  async function createCampaign(event) {
    event?.preventDefault();
    if (loading) return;
    const topic = $("creator-campaign-topic").value.trim();
    if (topic.length < 8) return setStatus("Enter a specific topic with at least eight characters.", true);
    loading = true;
    const button = $("creator-campaign-generate");
    button.disabled = true;
    setStatus("JARVIS is building the campaign pack" + ($("creator-campaign-trends").checked ? " and checking the last 24 hours of sources…" : "…"));
    try {
      const result = await api("/api/creator/campaigns", {
        method: "POST",
        body: JSON.stringify({
          topic,
          audience: $("creator-campaign-audience").value,
          language: $("creator-campaign-language").value,
          sourceText: $("creator-campaign-sources").value,
          brandKit: {
            brandName: $("creator-campaign-brand-name").value,
            accentColor: $("creator-campaign-accent").value,
            backgroundColor: $("creator-campaign-background").value,
            textColor: $("creator-campaign-text").value
          },
          includeTrendRadar: $("creator-campaign-trends").checked
        })
      });
      render(result.campaign);
      await loadHistory();
      toast("Creator Campaign Pack saved as a draft.");
    } catch (error) {
      setStatus(error.message || "Campaign generation failed.", true);
      toast(error.message || "Campaign generation failed.", true);
    } finally {
      loading = false;
      button.disabled = false;
    }
  }

  function exportAssetBundle() {
    if (!current) return;
    try {
      const files = buildCreatorAssetFiles(current);
      const zip = buildStoredZip(files);
      download(safeName(current.topic) + "-creator-assets.zip", zip, "application/zip");
      setStatus("Downloaded " + files.length + " creator assets: carousel SVGs, storyboard CSV, subtitles and chapter readiness. Review the files before use.");
    } catch (error) {
      setStatus(error.message || "The creator asset ZIP could not be built.", true);
    }
  }

  function exportCaptions(format) {
    if (!current) return;
    const result = buildCreatorCaptions(current);
    const isSrt = format === "srt";
    download(safeName(current.topic) + "-captions." + format, isSrt ? result.srt : result.vtt,
      isSrt ? "application/x-subrip;charset=utf-8" : "text/vtt;charset=utf-8");
    setStatus("Exported " + format.toUpperCase() + " scene captions. Check their timing against the recorded voiceover.");
  }

  function exportStoryboard() {
    if (!current) return;
    download(safeName(current.topic) + "-storyboard.csv", buildCreatorStoryboardCsv(current), "text/csv;charset=utf-8");
    setStatus("Storyboard CSV exported with scene timings and visual notes.");
  }

  function exportChapters() {
    if (!current) return;
    try {
      download(safeName(current.topic) + "-youtube-chapters.txt", buildYouTubeChapters(current), "text/plain;charset=utf-8");
      setStatus("YouTube chapter timestamps exported. Confirm them against the final video duration.");
    } catch (error) {
      setStatus(error.message || "This scene plan is too short for valid YouTube chapters.", true);
    }
  }

  async function sendToMediaStudio() {
    if (!current || mediaProjectCreated) return;
    const button = $("creator-campaign-to-media");
    button.disabled = true;
    try {
      const result = await api("/api/creator/campaigns/" + encodeURIComponent(current.id) + "/media-project", { method: "POST" });
      mediaProjectCreated = true;
      button.textContent = "Added to Media Studio";
      setStatus("Short-video scenes copied into Media Studio as an editable draft. Check visuals, assets, audio and timing there.");
      toast("Media Studio draft created.");
      document.querySelector('.nav-item[data-view="media"]')?.click();
    } catch (error) {
      button.disabled = false;
      setStatus(error.message || "Could not create the Media Studio draft.", true);
      toast(error.message || "Could not create the Media Studio draft.", true);
    }
  }

  function init() {
    const form = $("creator-campaign-form");
    if (!form || form.dataset.initialized === "true") return;
    form.dataset.initialized = "true";
    const mainTopic = $("creator-topic")?.value?.trim();
    if (mainTopic) $("creator-campaign-topic").value = mainTopic;
    form.addEventListener("submit", createCampaign);
    $("creator-campaign-export-json").addEventListener("click", () => {
      if (!current) return;
      download(safeName(current.topic) + "-campaign.json", JSON.stringify(current, null, 2), "application/json;charset=utf-8");
    });
    $("creator-campaign-export-md").addEventListener("click", () => {
      if (!current) return;
      download(safeName(current.topic) + "-campaign.md", markdown(current), "text/markdown;charset=utf-8");
    });
    $("creator-campaign-save-revision").addEventListener("click", saveRevision);
    $("creator-campaign-export-assets").addEventListener("click", exportAssetBundle);
    $("creator-campaign-export-srt").addEventListener("click", () => exportCaptions("srt"));
    $("creator-campaign-export-vtt").addEventListener("click", () => exportCaptions("vtt"));
    $("creator-campaign-export-csv").addEventListener("click", exportStoryboard);
    $("creator-campaign-export-chapters").addEventListener("click", exportChapters);
    $("creator-campaign-to-media").addEventListener("click", sendToMediaStudio);
    void loadHistory();
  }

  return { init, loadHistory, render };
}
