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

    const heading = card(target, pack.title, "Draft pack · " + pack.engine + " · " + pack.language);
    add(heading, "p", "small muted", "Topic: " + pack.topic + " · Audience: " + pack.audience);

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

    const video = card(target, "Short video · " + pack.shortVideo.durationSeconds + "s", "Hook: " + pack.shortVideo.hook);
    add(video, "p", "small muted", pack.shortVideo.caption);
    for (const [index, scene] of pack.shortVideo.scenes.entries()) {
      const item = add(video, "article", "creator-campaign-scene");
      add(item, "strong", "", (index + 1) + ". " + scene.heading + " · " + scene.durationSeconds + "s");
      add(item, "p", "", scene.voiceover);
      add(item, "p", "small muted", "On screen: " + scene.onScreenText);
      add(item, "p", "small muted", "Visual: " + scene.visualPrompt);
    }

    const carousel = card(target, "Instagram carousel · " + pack.carousel.slides.length + " slides", pack.carousel.caption);
    for (const [index, slide] of pack.carousel.slides.entries()) {
      const item = add(carousel, "article", "creator-campaign-slide");
      add(item, "strong", "", (index + 1) + ". " + slide.heading);
      add(item, "p", "", slide.body);
      add(item, "p", "small muted", "Visual: " + slide.visualPrompt);
    }
    add(carousel, "p", "small muted", "Comment CTA: " + pack.carousel.commentCTA);

    const seo = card(target, "SEO page draft", "Slug: /" + pack.seoPage.slug);
    add(seo, "p", "", "Meta title: " + pack.seoPage.metaTitle);
    add(seo, "p", "", "Meta description: " + pack.seoPage.metaDescription);
    add(seo, "h3", "", pack.seoPage.h1);
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
      add(social, "p", "", draft.caption);
      add(social, "p", "", draft.cta);
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

    setStatus(pack.generationNote || "Campaign draft is ready. Review sources and claims.");
    $("creator-campaign-export-json").disabled = false;
    $("creator-campaign-export-md").disabled = false;
    $("creator-campaign-to-media").disabled = false;
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
    $("creator-campaign-to-media").addEventListener("click", sendToMediaStudio);
    void loadHistory();
  }

  return { init, loadHistory, render };
}
