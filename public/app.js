const $ = (selector) => document.querySelector(selector);
const state = { chats: [], memories: [], memoryTotal: 0, memoryQuery: "", memoryCategory: "", tasks: [], feedback: [], experiencePreferences: [], skills: [], editingSkillId: null, workflows: [], workflowRuns: [], workflowSteps: [], editingWorkflowId: null, integrations: [], integrationResults: {}, devices: [], research: [], knowledge: [], knowledgeTotal: 0, knowledgeQuery: "", activeView: "chat" };
let toastTimer;
let activeRecognition = null;

function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 3800);
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && url !== "/api/login") {
    showLogin();
    throw new Error("Your session expired. Please sign in again.");
  }
  if (!response.ok) throw new Error(payload.error || "Request failed. Please try again.");
  return payload;
}

function showLogin() {
  $("#login-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
}

function showApp() {
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
}

async function boot() {
  try {
    await api("/api/session");
    showApp();
    await refreshState();
  } catch {
    showLogin();
  }
}

async function refreshState() {
  const data = await api("/api/state");
  state.chats = data.chats || [];
  state.memories = data.memories || [];
  state.memoryTotal = state.memories.length;
  state.tasks = data.tasks || [];
  const experience = await api("/api/experience");
  const workflowData = await api("/api/workflows");
  const integrationData = await api("/api/integrations");
  state.integrations = integrationData.providers || [];
  state.feedback = experience.feedback || data.feedback || [];
  state.experiencePreferences = experience.preferences || data.experiencePreferences || [];
  state.workflows = workflowData.workflows || data.workflows || [];
  state.workflowRuns = workflowData.runs || data.workflowRuns || [];
  state.skills = data.skills || [];
  state.research = data.research || [];
  renderChats();
  renderMemories();
  renderTasks();
  renderSkills();
  renderExperience(experience.summary);
  renderWorkflows();
  renderIntegrations();
  renderSavedResearch();
  await refreshKnowledge();
}

function setView(name) {
  state.activeView = name;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
  $("#view-" + name).classList.remove("hidden");
  const titles = {
    chat: ["PERSONAL ASSISTANT", "Assistant"],
    devices: ["ANDROID COMPANION", "Device Control"],
    memory: ["PERSONAL CONTEXT", "Memory"],
    tasks: ["ORGANIZATION", "Tasks"],
    research: ["WEB DISCOVERY", "Research"],
    knowledge: ["PERSONAL KNOWLEDGE LIBRARY", "Knowledge"],
    experience: ["EXPERIENCE & SELF-IMPROVEMENT", "Experience"],
    workflows: ["AUTOMATION & EXECUTION", "Workflows"],
    integrations: ["CONNECTED SERVICES", "Connections"]
  };
  $("#page-kicker").textContent = titles[name][0];
  $("#page-title").textContent = titles[name][1];
  if (name === "chat") setTimeout(() => $("#chat-input").focus(), 0);
  if (name === "devices") refreshDevices().catch((error) => toast(error.message, true));
  if (name === "memory") refreshMemories().catch((error) => toast(error.message, true));
  if (name === "workflows") refreshWorkflows().catch((error) => toast(error.message, true));
  if (name === "integrations") refreshIntegrations().catch((error) => toast(error.message, true));
}

function makeEmpty(message) {
  const el = document.createElement("div");
  el.className = "empty-state";
  el.textContent = message;
  return el;
}

function renderChats() {
  const target = $("#chat-messages");
  target.replaceChildren();
  const messages = state.chats.slice(-28);
  if (!messages.length) {
    $("#chat-messages").classList.add("hidden");
    $(".chat-intro").classList.remove("hidden");
    return;
  }
  $("#chat-messages").classList.remove("hidden");
  $(".chat-intro").classList.add("hidden");
  for (let index = 0; index < messages.length; index++) {
    const item = messages[index];
    if (item.role !== "user" && item.role !== "assistant") continue;
    const row = document.createElement("article");
    row.className = "message " + item.role;
    const mark = document.createElement("div");
    mark.className = "message-mark";
    mark.textContent = item.role === "user" ? "Y" : "J";
    mark.setAttribute("aria-hidden", "true");
    const wrap = document.createElement("div");
    wrap.className = "message-wrap";
    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = item.content || "";
    wrap.append(body);
    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
    if (item.role === "assistant" && item.engine === "gemini-conversation") {
      time.textContent += " · Gemini";
    } else if (item.role === "assistant" && item.engine === "built-in-offline-fallback") {
      time.textContent += " · Offline fallback";
    } else if (item.role === "assistant" && item.engine === "built-in-offline") {
      time.textContent += " · Offline brain";
    }
    wrap.append(time);
    if (item.role === "assistant" && Array.isArray(item.sources) && item.sources.length) {
      const sourceList = document.createElement("div");
      sourceList.className = "message-sources";
      const sourceHeading = document.createElement("strong");
      sourceHeading.textContent = "Live sources";
      sourceList.append(sourceHeading);
      for (const source of item.sources.slice(0, 10)) {
        const safe = safeResearchUrl(source?.url);
        if (!safe) continue;
        const link = document.createElement("a");
        link.href = safe;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.title || new URL(safe).hostname;
        sourceList.append(link);
      }
      if (sourceList.querySelector("a")) wrap.append(sourceList);
    }
    if (item.role === "assistant") {
      const previousUser = [...messages.slice(0, index)].reverse().find((entry) => entry.role === "user");
      if (previousUser) {
        const feedback = document.createElement("div");
        feedback.className = "message-feedback";
        if (item.feedbackSent) {
          const status = document.createElement("span");
          status.className = "message-feedback-state";
          status.textContent = item.feedbackSent === "up" ? "Thanks — marked helpful" : "Thanks — feedback saved";
          feedback.append(status);
        } else {
          const helpful = document.createElement("button");
          helpful.type = "button";
          helpful.className = "item-action";
          helpful.textContent = "Helpful";
          helpful.addEventListener("click", async () => {
            helpful.disabled = true;
            try {
              const data = await api("/api/feedback", {
                method: "POST",
                body: JSON.stringify({ rating: "up", category: "other", engine: item.engine || "unknown" })
              });
              state.feedback.unshift(data.feedback);
              item.feedbackSent = "up";
              renderChats();
              renderExperience();
              toast("Feedback saved.");
            } catch (error) {
              toast(error.message, true);
              helpful.disabled = false;
            }
          });

          const needsWork = document.createElement("button");
          needsWork.type = "button";
          needsWork.className = "item-action";
          needsWork.textContent = "Needs work";
          needsWork.addEventListener("click", () => {
            item.showFeedbackForm = !item.showFeedbackForm;
            renderChats();
          });
          feedback.append(helpful, needsWork);
          if (item.showFeedbackForm) {
            const form = document.createElement("form");
            form.className = "message-feedback-form";
            const category = document.createElement("select");
            category.setAttribute("aria-label", "Feedback category");
            for (const [value, label] of [
              ["accuracy", "Accuracy / facts"],
              ["clarity", "Clarity / explanation"],
              ["tone", "Tone"],
              ["relevance", "Relevance"],
              ["format", "Formatting"],
              ["other", "Other"]
            ]) {
              const option = document.createElement("option");
              option.value = value;
              option.textContent = label;
              category.append(option);
            }
            category.value = "clarity";
            const suggestion = document.createElement("textarea");
            suggestion.maxLength = 500;
            suggestion.rows = 2;
            suggestion.placeholder = "What should JARVIS do differently next time? (optional)";
            suggestion.setAttribute("aria-label", "Optional improvement suggestion");
            const submit = document.createElement("button");
            submit.type = "submit";
            submit.className = "item-action";
            submit.textContent = "Save feedback";
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "item-action";
            cancel.textContent = "Cancel";
            cancel.addEventListener("click", () => {
              item.showFeedbackForm = false;
              renderChats();
            });
            form.append(category, suggestion, submit, cancel);
            form.addEventListener("submit", async (event) => {
              event.preventDefault();
              submit.disabled = true;
              try {
                const data = await api("/api/feedback", {
                  method: "POST",
                  body: JSON.stringify({
                    rating: "down",
                    category: category.value,
                    suggestion: suggestion.value,
                    engine: item.engine || "unknown"
                  })
                });
                state.feedback.unshift(data.feedback);
                item.feedbackSent = "down";
                item.showFeedbackForm = false;
                renderChats();
                renderExperience();
                toast("Feedback saved. Review it in Experience before applying a preference.");
              } catch (error) {
                toast(error.message, true);
                submit.disabled = false;
              }
            });
            wrap.append(form);
          }
        }
        wrap.append(feedback);
      }
    }
    row.append(mark, wrap);
    target.append(row);
  }
  target.scrollTop = target.scrollHeight;
}

function renderStorageOverview() {
  const target = $("#storage-overview-text");
  if (!target) return;
  target.textContent = [
    "Personal memories: " + state.memoryTotal,
    "Knowledge notes: " + state.knowledgeTotal,
    "Saved research: " + state.research.length,
    "Tasks: " + state.tasks.length,
    "Custom skills: " + state.skills.length,
    "Approved response preferences: " + state.experiencePreferences.length,
    "Workflows: " + state.workflows.length,
    "Workflow runs: " + state.workflowRuns.length,
    "Connected service configurations: " + state.integrations.filter((item) => item.configured).length,
    "Temporary chats: not stored in the persistent database"
  ].join(" · ");
}

function renderMemories() {
  const target = $("#memory-list");
  if (!target) return;
  target.replaceChildren();
  $("#memory-count").textContent = state.memoryQuery || state.memoryCategory
    ? state.memories.length + " shown · " + state.memoryTotal + " total"
    : state.memoryTotal + " saved";

  if (!state.memories.length) {
    target.append(makeEmpty(state.memoryQuery || state.memoryCategory
      ? "No memories matched this search or category."
      : "No saved memories yet. Add a preference, goal, or useful fact above."));
    renderStorageOverview();
    return;
  }

  for (const item of state.memories) {
    const row = document.createElement("article");
    row.className = "list-item";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = item.content || "";
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    const created = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "";
    const updated = item.updatedAt && item.updatedAt !== item.createdAt
      ? " · Updated " + new Date(item.updatedAt).toLocaleDateString()
      : "";
    meta.textContent = (item.category || "fact") + " · Saved " + created + updated;
    main.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "device-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "item-action";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      const editor = document.createElement("form");
      editor.className = "memory-edit-form form-card";
      const contentLabel = document.createElement("label");
      contentLabel.textContent = "Edit saved memory";
      const content = document.createElement("textarea");
      content.rows = 3;
      content.maxLength = 500;
      content.required = true;
      content.value = item.content || "";
      contentLabel.append(content);

      const categoryLabel = document.createElement("label");
      categoryLabel.textContent = "Category";
      const category = document.createElement("select");
      for (const [value, label] of [["preference", "Preference"], ["goal", "Goal"], ["fact", "Fact"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        category.append(option);
      }
      category.value = item.category || "fact";
      categoryLabel.append(category);

      const controls = document.createElement("div");
      controls.className = "form-row";
      const save = document.createElement("button");
      save.type = "submit";
      save.className = "primary";
      save.textContent = "Save changes";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "item-action";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => row.replaceChildren(main, actions));
      controls.append(cancel, save);
      editor.append(contentLabel, categoryLabel, controls);
      row.replaceChildren(main, editor);
      content.focus();

      editor.addEventListener("submit", async (event) => {
        event.preventDefault();
        save.disabled = true;
        try {
          await api("/api/memories/" + encodeURIComponent(item.id), {
            method: "PATCH",
            body: JSON.stringify({ content: content.value, category: category.value })
          });
          await refreshMemories(state.memoryQuery, state.memoryCategory);
          toast("Memory updated.");
        } catch (error) {
          toast(error.message, true);
          save.disabled = false;
        }
      });
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "item-action";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", "Delete saved memory");
    remove.addEventListener("click", async () => {
      if (!confirm("Delete this saved memory?")) return;
      remove.disabled = true;
      try {
        await api("/api/memories/" + encodeURIComponent(item.id), { method: "DELETE" });
        state.memoryTotal = Math.max(0, state.memoryTotal - 1);
        await refreshMemories(state.memoryQuery, state.memoryCategory);
        toast("Memory deleted.");
      } catch (error) {
        toast(error.message, true);
        remove.disabled = false;
      }
    });

    actions.append(edit, remove);
    row.append(main, actions);
    target.append(row);
  }
  renderStorageOverview();
}

async function refreshMemories(query = state.memoryQuery, category = state.memoryCategory) {
  state.memoryQuery = String(query || "").trim();
  state.memoryCategory = String(category || "");
  const params = new URLSearchParams();
  if (state.memoryQuery) params.set("q", state.memoryQuery);
  if (state.memoryCategory) params.set("category", state.memoryCategory);
  const suffix = params.toString() ? "?" + params.toString() : "";
  const data = await api("/api/memories" + suffix);
  state.memories = Array.isArray(data.items) ? data.items : [];
  state.memoryTotal = Number(data.total) || 0;
  renderMemories();
}

function renderSkills() {
  const target = $("#skill-list");
  if (!target) return;
  target.replaceChildren();
  if (!state.skills.length) {
    target.append(makeEmpty("No skill drafts yet. Create one above, test its triggers, then approve it."));
    renderStorageOverview();
    return;
  }

  for (const skill of [...state.skills].reverse()) {
    const row = document.createElement("article");
    row.className = "list-item skill-item";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = skill.name || "Untitled skill";
    const status = document.createElement("span");
    status.className = "skill-status skill-status-" + (skill.status || "draft");
    status.textContent = (skill.status || "draft").replace("-", " ");
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    meta.textContent = [
      "Current v" + (skill.currentVersion || 1),
      skill.activeVersion ? "Active v" + skill.activeVersion : "Not activated",
      "Created " + new Date(skill.createdAt).toLocaleDateString()
    ].join(" · ");
    const instructions = document.createElement("p");
    instructions.textContent = skill.instructions || "";
    const triggerMeta = document.createElement("div");
    triggerMeta.className = "list-item-meta";
    triggerMeta.textContent = "Triggers: " + ((skill.triggers || []).join(", ") || "No trigger phrases");
    main.append(title, status, meta, instructions, triggerMeta);

    const latest = (skill.versions || []).find((version) => version.version === skill.currentVersion);
    if (latest?.validation) {
      const validation = document.createElement("div");
      validation.className = "list-item-meta";
      validation.textContent = "Latest test: " + (latest.validation.passed ? "Passed" : "Failed") +
        " · " + (latest.validation.checks || []).filter((item) => item.passed).length +
        "/" + (latest.validation.checks || []).length + " checks";
      main.append(validation);
    }

    const history = document.createElement("details");
    history.className = "skill-history";
    const summary = document.createElement("summary");
    summary.textContent = "Version history (" + (skill.versions || []).length + ")";
    history.append(summary);
    for (const version of [...(skill.versions || [])].sort((a, b) => b.version - a.version)) {
      const item = document.createElement("div");
      item.className = "list-item-meta";
      const validationLabel = version.validation
        ? (version.validation.passed ? " · Tests passed" : " · Tests failed")
        : " · Not tested";
      const approvalLabel = version.approvedAt ? " · Approved " + new Date(version.approvedAt).toLocaleDateString() : "";
      item.textContent = "v" + version.version + " · " + new Date(version.createdAt).toLocaleDateString() + validationLabel + approvalLabel;
      history.append(item);
    }
    main.append(history);

    const actions = document.createElement("div");
    actions.className = "skill-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "item-action";
    edit.textContent = "New version";
    edit.addEventListener("click", () => {
      const current = (skill.versions || []).find((version) => version.version === skill.currentVersion) || skill;
      state.editingSkillId = skill.id;
      $("#skill-name").value = current.name || skill.name || "";
      $("#skill-instructions").value = current.instructions || skill.instructions || "";
      $("#skill-triggers").value = (current.triggers || []).join(", ");
      const positive = (current.testCases || []).find((item) => item.shouldMatch);
      const negative = (current.testCases || []).find((item) => !item.shouldMatch);
      $("#skill-positive-test").value = positive?.input || "";
      $("#skill-negative-test").value = negative?.input || "";
      $("#skill-form-title").textContent = "Create a new skill version";
      $("#skill-submit-button").textContent = "Save new version";
      $("#skill-cancel-edit").classList.remove("hidden");
      $("#skill-form").scrollIntoView({ behavior: "smooth", block: "start" });
      $("#skill-name").focus();
    });

    const validate = document.createElement("button");
    validate.type = "button";
    validate.className = "item-action";
    validate.textContent = "Run tests";
    validate.addEventListener("click", async () => {
      validate.disabled = true;
      try {
        const data = await api("/api/skills/" + encodeURIComponent(skill.id) + "/validate", {
          method: "POST", body: JSON.stringify({})
        });
        state.skills = state.skills.map((item) => item.id === skill.id ? data.skill : item);
        renderSkills();
        toast(data.validation.passed
          ? "Skill tests passed. Review the skill and approve it to activate."
          : "Some skill tests failed. Edit the draft and try again.");
      } catch (error) {
        toast(error.message, true);
        validate.disabled = false;
      }
    });

    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "item-action";
    approve.textContent = "Approve & activate";
    approve.disabled = !latest?.validation?.passed || latest.validation.version !== skill.currentVersion;
    approve.addEventListener("click", async () => {
      if (!confirm("Approve this skill version and let it guide matching Gemini requests?")) return;
      approve.disabled = true;
      try {
        const data = await api("/api/skills/" + encodeURIComponent(skill.id) + "/approve", {
          method: "POST", body: JSON.stringify({})
        });
        state.skills = state.skills.map((item) => item.id === skill.id ? data.skill : item);
        renderSkills();
        toast("Skill version approved and activated.");
      } catch (error) {
        toast(error.message, true);
        approve.disabled = false;
      }
    });

    const pause = document.createElement("button");
    pause.type = "button";
    pause.className = "item-action";
    pause.textContent = "Pause";
    pause.disabled = !skill.activeVersion || skill.status === "paused";
    pause.addEventListener("click", async () => {
      pause.disabled = true;
      try {
        const data = await api("/api/skills/" + encodeURIComponent(skill.id) + "/pause", {
          method: "POST", body: JSON.stringify({})
        });
        state.skills = state.skills.map((item) => item.id === skill.id ? data.skill : item);
        renderSkills();
        toast("Skill paused. It will no longer be added to matching Gemini requests.");
      } catch (error) {
        toast(error.message, true);
        pause.disabled = false;
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "item-action";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm("Delete this skill and all its saved versions?")) return;
      remove.disabled = true;
      try {
        await api("/api/skills/" + encodeURIComponent(skill.id), { method: "DELETE" });
        state.skills = state.skills.filter((item) => item.id !== skill.id);
        renderSkills();
        toast("Skill and its version history deleted.");
      } catch (error) {
        toast(error.message, true);
        remove.disabled = false;
      }
    });

    actions.append(edit, validate, approve, pause, remove);
    row.append(main, actions);
    target.append(row);
  }
  renderStorageOverview();
}


function renderExperience(summary = null) {
  const metricsTarget = $("#experience-metrics");
  const categoriesTarget = $("#experience-categories");
  const feedbackTarget = $("#experience-feedback");
  const preferencesTarget = $("#experience-preferences");
  if (!metricsTarget || !categoriesTarget || !feedbackTarget || !preferencesTarget) return;

  const positive = state.feedback.filter((item) => item.rating === "up").length;
  const needsWork = state.feedback.filter((item) => item.rating === "down").length;
  const pending = state.feedback.filter((item) =>
    item.rating === "down" && String(item.suggestion || "").trim().length >= 20 && !item.preferenceId
  ).length;
  const active = state.experiencePreferences.filter((item) => item.active).length;
  const values = [
    ["Helpful", summary?.helpful ?? positive],
    ["Needs work", summary?.needsWork ?? needsWork],
    ["Pending suggestions", summary?.pendingSuggestions ?? pending],
    ["Active preferences", summary?.activePreferences ?? active]
  ];
  metricsTarget.replaceChildren();
  for (const [label, value] of values) {
    const card = document.createElement("div");
    card.className = "experience-metric";
    const number = document.createElement("strong");
    number.textContent = String(value);
    const title = document.createElement("span");
    title.textContent = label;
    card.append(number, title);
    metricsTarget.append(card);
  }

  const categoryCounts = summary?.categories || Object.fromEntries(
    ["accuracy", "clarity", "tone", "relevance", "format", "other"].map((category) => [
      category,
      state.feedback.filter((item) => item.rating === "down" && item.category === category).length
    ])
  );
  categoriesTarget.replaceChildren();
  const categoryTitle = document.createElement("strong");
  categoryTitle.textContent = "Needs-work categories";
  categoriesTarget.append(categoryTitle);
  for (const [category, count] of Object.entries(categoryCounts)) {
    const tag = document.createElement("span");
    tag.className = "experience-category";
    tag.textContent = category + " · " + count;
    categoriesTarget.append(tag);
  }

  preferencesTarget.replaceChildren();
  if (!state.experiencePreferences.length) {
    preferencesTarget.append(makeEmpty("No approved response preferences yet. Review a suggestion from the feedback list and approve it when it looks right."));
  } else {
    for (const preference of [...state.experiencePreferences].reverse()) {
      const row = document.createElement("article");
      row.className = "list-item experience-item";
      const main = document.createElement("div");
      main.className = "list-item-main";
      const title = document.createElement("strong");
      title.textContent = preference.category + " preference";
      const text = document.createElement("p");
      text.textContent = preference.content;
      const meta = document.createElement("div");
      meta.className = "list-item-meta";
      meta.textContent = (preference.active ? "Active in Gemini context" : "Paused") +
        " · Approved " + new Date(preference.approvedAt || preference.createdAt).toLocaleDateString();
      main.append(title, text, meta);
      const actions = document.createElement("div");
      actions.className = "experience-actions";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "item-action";
      toggle.textContent = preference.active ? "Pause" : "Enable";
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          const data = await api("/api/experience/preferences/" + encodeURIComponent(preference.id), {
            method: "PATCH",
            body: JSON.stringify({ active: !preference.active })
          });
          state.experiencePreferences = state.experiencePreferences.map((item) =>
            item.id === preference.id ? data.preference : item
          );
          renderExperience();
          toast(data.preference.active ? "Response preference enabled." : "Response preference paused.");
        } catch (error) {
          toast(error.message, true);
          toggle.disabled = false;
        }
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "item-action";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        if (!confirm("Delete this approved response preference?")) return;
        remove.disabled = true;
        try {
          await api("/api/experience/preferences/" + encodeURIComponent(preference.id), { method: "DELETE" });
          state.experiencePreferences = state.experiencePreferences.filter((item) => item.id !== preference.id);
          renderExperience();
          toast("Response preference deleted.");
        } catch (error) {
          toast(error.message, true);
          remove.disabled = false;
        }
      });
      actions.append(toggle, remove);
      row.append(main, actions);
      preferencesTarget.append(row);
    }
  }

  feedbackTarget.replaceChildren();
  if (!state.feedback.length) {
    feedbackTarget.append(makeEmpty("No feedback yet. Use Helpful or Needs work below a JARVIS reply to start reviewing its quality."));
  } else {
    for (const item of state.feedback.slice(0, 100)) {
      const row = document.createElement("article");
      row.className = "list-item experience-item";
      const main = document.createElement("div");
      main.className = "list-item-main";
      const title = document.createElement("strong");
      title.textContent = item.rating === "up" ? "Marked helpful" : "Needs work · " + (item.category || "other");
      const meta = document.createElement("div");
      meta.className = "list-item-meta";
      meta.textContent = new Date(item.createdAt).toLocaleString() + " · " + (item.engine || "unknown engine");
      main.append(title, meta);
      if (item.suggestion) {
        const suggestion = document.createElement("p");
        suggestion.textContent = item.suggestion;
        main.append(suggestion);
      } else if (item.rating === "down") {
        const emptySuggestion = document.createElement("div");
        emptySuggestion.className = "list-item-meta";
        emptySuggestion.textContent = "No improvement suggestion was added.";
        main.append(emptySuggestion);
      }

      const actions = document.createElement("div");
      actions.className = "experience-actions";
      if (item.preferenceId) {
        const reviewed = document.createElement("span");
        reviewed.className = "experience-reviewed";
        reviewed.textContent = "Reviewed";
        actions.append(reviewed);
      } else if (item.rating === "down" && String(item.suggestion || "").trim().length >= 20) {
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "item-action";
        approve.textContent = "Approve as preference";
        approve.disabled = state.experiencePreferences.length >= 30;
        approve.addEventListener("click", async () => {
          if (!confirm("Approve this suggestion as a response preference for future matching Gemini conversations?")) return;
          approve.disabled = true;
          try {
            const data = await api("/api/feedback/" + encodeURIComponent(item.id) + "/approve", {
              method: "POST",
              body: JSON.stringify({})
            });
            state.feedback = state.feedback.map((entry) => entry.id === item.id ? data.feedback : entry);
            state.experiencePreferences.push(data.preference);
            renderExperience();
            toast("Preference approved. You can pause or delete it anytime.");
          } catch (error) {
            toast(error.message, true);
            approve.disabled = false;
          }
        });
        actions.append(approve);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "item-action";
      remove.textContent = "Delete feedback";
      remove.addEventListener("click", async () => {
        if (!confirm("Delete this feedback record? Any separately approved preference will remain unchanged.")) return;
        remove.disabled = true;
        try {
          await api("/api/feedback/" + encodeURIComponent(item.id), { method: "DELETE" });
          state.feedback = state.feedback.filter((entry) => entry.id !== item.id);
          renderExperience();
          toast("Feedback record deleted.");
        } catch (error) {
          toast(error.message, true);
          remove.disabled = false;
        }
      });
      actions.append(remove);
      row.append(main, actions);
      feedbackTarget.append(row);
    }
  }
}


async function refreshIntegrations() {
  const data = await api("/api/integrations");
  state.integrations = data.providers || [];
  renderIntegrations();
}

function integrationDetailText(provider, result) {
  const details = result?.details || {};
  if (provider === "github") {
    return details.login
      ? "Signed in as " + details.login + (details.publicRepos === null ? "" : " · " + details.publicRepos + " public repositories")
      : "GitHub connection verified.";
  }
  if (provider === "google_drive") return "Connection verified · " + (details.recentFiles ?? 0) + " recent files listed.";
  if (provider === "telegram") return details.username ? "Connected to bot @" + details.username : "Telegram bot connection verified.";
  if (provider === "elevenlabs") return "Account verified · Plan: " + (details.tier || "unknown");
  return "Connection verified.";
}

function renderIntegrations() {
  const target = $("#integration-provider-list");
  if (!target) return;
  target.replaceChildren();
  if (!state.integrations.length) {
    target.append(makeEmpty("Integration catalogue is unavailable."));
    return;
  }
  for (const provider of state.integrations) {
    const row = document.createElement("article");
    row.className = "list-item integration-provider";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = provider.name;
    const status = document.createElement("span");
    const lastResult = state.integrationResults[provider.id];
    status.className = "integration-status " + (lastResult?.connected ? "connected" : provider.configured ? "configured" : "not-configured");
    status.textContent = lastResult?.connected ? "Connected" : provider.configured ? "Configured · not tested" : "Not configured";
    const access = document.createElement("p");
    access.textContent = provider.access;
    const variable = document.createElement("code");
    variable.textContent = provider.environmentVariable;
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    meta.textContent = provider.capabilities.map((item) => item.replaceAll("_", " ")).join(" · ");
    main.append(title, status, access, variable, meta);

    const actions = document.createElement("div");
    actions.className = "integration-actions";
    const test = document.createElement("button");
    test.type = "button";
    test.className = "item-action";
    test.textContent = "Test connection";
    test.disabled = !provider.configured;
    test.addEventListener("click", async () => {
      test.disabled = true;
      test.textContent = "Testing…";
      try {
        const result = await api("/api/integrations/" + encodeURIComponent(provider.id) + "/test", {
          method: "POST",
          body: JSON.stringify({})
        });
        state.integrationResults[provider.id] = result;
        renderIntegrations();
        toast(provider.name + " connection verified.");
      } catch (error) {
        state.integrationResults[provider.id] = { connected: false, error: error.message };
        renderIntegrations();
        toast(error.message, true);
      }
    });
    actions.append(test);
    row.append(main, actions);
    target.append(row);

    if (lastResult?.error) {
      const message = document.createElement("p");
      message.className = "integration-error";
      message.textContent = lastResult.error;
      main.append(message);
    } else if (lastResult?.connected) {
      const detail = document.createElement("p");
      detail.className = "integration-success";
      detail.textContent = integrationDetailText(provider.id, lastResult);
      main.append(detail);
    }
  }
}

function workflowStepLabel(type) {
  return ({
    create_task: "Create local task",
    save_memory: "Save personal memory",
    search_knowledge: "Search saved Knowledge",
    draft_text: "Prepare text draft",
    review_checkpoint: "Pause for review",
    github_list_repositories: "Read GitHub repositories",
    google_drive_list_files: "Read recent Google Drive files",
    telegram_get_bot_profile: "Check Telegram bot profile",
    elevenlabs_get_account: "Read ElevenLabs account summary"
  })[type] || "Workflow step";
}

function workflowStepDetail(step) {
  if (step.type === "create_task") return step.description || "Create a task in the Tasks section.";
  if (step.type === "save_memory") return "[" + step.category + "] " + step.content;
  if (step.type === "search_knowledge") return "Search: " + step.query;
  if (step.type === "draft_text") return step.content;
  if (step.type === "github_list_repositories") return "Read-only · Lists up to eight recently updated repositories using the configured GitHub token.";
  if (step.type === "google_drive_list_files") return "Read-only · Lists up to eight recent Drive file names and metadata.";
  if (step.type === "telegram_get_bot_profile") return "Read-only · Checks the configured Telegram bot identity. It does not send messages.";
  if (step.type === "elevenlabs_get_account") return "Read-only · Reads a limited account and subscription summary.";
  return step.message || "Wait for your review before continuing.";
}

function renderWorkflowBuilderSteps() {
  const target = $("#workflow-builder-steps");
  if (!target) return;
  target.replaceChildren();
  $("#workflow-step-count").textContent = state.workflowSteps.length + " / 10";
  if (!state.workflowSteps.length) {
    target.append(makeEmpty("No steps added yet. Add at least one step to create a workflow."));
    return;
  }
  state.workflowSteps.forEach((step, index) => {
    const row = document.createElement("article");
    row.className = "list-item workflow-step-preview";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = (index + 1) + ". " + step.title;
    const type = document.createElement("div");
    type.className = "list-item-meta";
    type.textContent = workflowStepLabel(step.type);
    const detail = document.createElement("p");
    detail.textContent = workflowStepDetail(step);
    main.append(title, type, detail);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "item-action";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      state.workflowSteps.splice(index, 1);
      renderWorkflowBuilderSteps();
    });
    row.append(main, remove);
    target.append(row);
  });
}

async function refreshWorkflows() {
  const data = await api("/api/workflows");
  state.workflows = data.workflows || [];
  state.workflowRuns = data.runs || [];
  renderWorkflows();
}

function renderWorkflows() {
  renderWorkflowBuilderSteps();
  const target = $("#workflow-list");
  const runsTarget = $("#workflow-runs");
  if (!target || !runsTarget) return;
  target.replaceChildren();
  runsTarget.replaceChildren();

  if (!state.workflows.length) {
    target.append(makeEmpty("No workflows saved yet. Build a local workflow above, validate it, then approve it before running."));
  } else {
    for (const workflow of state.workflows) {
      const row = document.createElement("article");
      row.className = "list-item workflow-item";
      const main = document.createElement("div");
      main.className = "list-item-main";
      const title = document.createElement("strong");
      title.textContent = workflow.name;
      const status = document.createElement("span");
      status.className = "workflow-status workflow-status-" + workflow.status;
      status.textContent = workflow.status;
      const meta = document.createElement("div");
      meta.className = "list-item-meta";
      meta.textContent = "Version " + workflow.version + " · " + workflow.steps.length + " step(s) · Created " + new Date(workflow.createdAt).toLocaleDateString();
      const description = document.createElement("p");
      description.textContent = workflow.description || "No description";
      const stepList = document.createElement("ol");
      stepList.className = "workflow-step-list";
      for (const step of workflow.steps) {
        const item = document.createElement("li");
        item.textContent = step.title + " · " + workflowStepLabel(step.type);
        stepList.append(item);
      }
      main.append(title, status, meta, description, stepList);
      if (workflow.validation) {
        const validation = document.createElement("div");
        validation.className = "list-item-meta";
        validation.textContent = "Latest validation: " + (workflow.validation.passed ? "Passed" : "Failed") +
          " · " + workflow.validation.checks.filter((item) => item.passed).length + "/" + workflow.validation.checks.length + " checks";
        main.append(validation);
      }

      const activeRun = state.workflowRuns.find((run) =>
        run.workflowId === workflow.id && ["running", "waiting_review"].includes(run.status)
      );
      const actions = document.createElement("div");
      actions.className = "workflow-actions";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "item-action";
      edit.textContent = "Edit / new version";
      edit.disabled = Boolean(activeRun);
      edit.addEventListener("click", () => {
        state.editingWorkflowId = workflow.id;
        state.workflowSteps = workflow.steps.map((step) => ({ ...step }));
        $("#workflow-name").value = workflow.name;
        $("#workflow-description").value = workflow.description || "";
        $("#workflow-form-title").textContent = "Create a new workflow version";
        $("#workflow-save-button").textContent = "Save new draft version";
        $("#workflow-cancel-edit").classList.remove("hidden");
        renderWorkflowBuilderSteps();
        $("#workflow-form").scrollIntoView({ behavior: "smooth", block: "start" });
        $("#workflow-name").focus();
      });

      const validate = document.createElement("button");
      validate.type = "button";
      validate.className = "item-action";
      validate.textContent = "Validate";
      validate.disabled = Boolean(activeRun);
      validate.addEventListener("click", async () => {
        validate.disabled = true;
        try {
          const data = await api("/api/workflows/" + encodeURIComponent(workflow.id) + "/validate", {
            method: "POST", body: JSON.stringify({})
          });
          state.workflows = state.workflows.map((item) => item.id === workflow.id ? data.workflow : item);
          renderWorkflows();
          toast(data.validation.passed ? "Workflow validation passed. Approve it before running." : "Workflow validation failed. Review the checks.");
        } catch (error) {
          toast(error.message, true);
          validate.disabled = false;
        }
      });

      const approve = document.createElement("button");
      approve.type = "button";
      approve.className = "item-action";
      approve.textContent = "Approve";
      approve.disabled = !workflow.validation?.passed || workflow.validation.version !== workflow.version || Boolean(activeRun) || workflow.status === "approved";
      approve.addEventListener("click", async () => {
        if (!confirm("Approve this workflow so it can be run later with a separate confirmation?")) return;
        approve.disabled = true;
        try {
          const data = await api("/api/workflows/" + encodeURIComponent(workflow.id) + "/approve", {
            method: "POST", body: JSON.stringify({})
          });
          state.workflows = state.workflows.map((item) => item.id === workflow.id ? data.workflow : item);
          renderWorkflows();
          toast("Workflow approved. Press Run when you are ready to execute it.");
        } catch (error) {
          toast(error.message, true);
          approve.disabled = false;
        }
      });

      const runButton = document.createElement("button");
      runButton.type = "button";
      runButton.className = "item-action";
      runButton.textContent = "Run";
      runButton.disabled = workflow.status !== "approved" || Boolean(activeRun);
      runButton.addEventListener("click", async () => {
        if (!confirm("Run this approved workflow now? It may create local tasks or save approved memory steps. Review checkpoints will pause for your decision.")) return;
        runButton.disabled = true;
        try {
          const data = await api("/api/workflows/" + encodeURIComponent(workflow.id) + "/run", {
            method: "POST", body: JSON.stringify({})
          });
          state.workflowRuns.unshift(data.run);
          renderWorkflows();
          toast(data.run.status === "waiting_review" ? "Workflow paused for your review." :
            data.run.status === "completed" ? "Workflow completed." : "Workflow status: " + data.run.status);
        } catch (error) {
          toast(error.message, true);
          runButton.disabled = false;
        }
      });

      const pause = document.createElement("button");
      pause.type = "button";
      pause.className = "item-action";
      pause.textContent = "Pause";
      pause.disabled = workflow.status !== "approved" || Boolean(activeRun);
      pause.addEventListener("click", async () => {
        pause.disabled = true;
        try {
          const data = await api("/api/workflows/" + encodeURIComponent(workflow.id) + "/pause", {
            method: "POST", body: JSON.stringify({})
          });
          state.workflows = state.workflows.map((item) => item.id === workflow.id ? data.workflow : item);
          renderWorkflows();
          toast("Workflow paused.");
        } catch (error) {
          toast(error.message, true);
          pause.disabled = false;
        }
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "item-action";
      remove.textContent = "Delete";
      remove.disabled = Boolean(activeRun);
      remove.addEventListener("click", async () => {
        if (!confirm("Delete this workflow? Existing execution history will remain.")) return;
        remove.disabled = true;
        try {
          await api("/api/workflows/" + encodeURIComponent(workflow.id), { method: "DELETE" });
          state.workflows = state.workflows.filter((item) => item.id !== workflow.id);
          renderWorkflows();
          toast("Workflow deleted. Execution history was kept.");
        } catch (error) {
          toast(error.message, true);
          remove.disabled = false;
        }
      });

      actions.append(edit, validate, approve, runButton, pause, remove);
      row.append(main, actions);
      target.append(row);
    }
  }

  if (!state.workflowRuns.length) {
    runsTarget.append(makeEmpty("No execution history yet. Approved workflows will appear here after you run them."));
  } else {
    for (const run of state.workflowRuns.slice(0, 50)) {
      const row = document.createElement("article");
      row.className = "list-item workflow-run-item";
      const main = document.createElement("div");
      main.className = "list-item-main";
      const title = document.createElement("strong");
      title.textContent = run.workflowName || "Workflow run";
      const status = document.createElement("span");
      status.className = "workflow-status workflow-status-" + run.status;
      status.textContent = run.status.replace("_", " ");
      const meta = document.createElement("div");
      meta.className = "list-item-meta";
      meta.textContent = "Version " + run.workflowVersion + " · " + new Date(run.createdAt).toLocaleString();
      main.append(title, status, meta);

      const steps = document.createElement("ol");
      steps.className = "workflow-run-steps";
      for (const step of run.steps || []) {
        const item = document.createElement("li");
        item.className = "workflow-run-step";
        const heading = document.createElement("strong");
        heading.textContent = step.title + " · " + step.status.replace("_", " ");
        item.append(heading);
        const detail = step.result?.summary || step.result?.message || step.result?.error;
        if (detail) {
          const text = document.createElement("p");
          text.textContent = detail;
          item.append(text);
        }
        if (step.result?.draft) {
          const draft = document.createElement("pre");
          draft.textContent = step.result.draft;
          item.append(draft);
        }
        if (Array.isArray(step.result?.results) && step.result.results.length) {
          const resultList = document.createElement("ul");
          for (const result of step.result.results.slice(0, 5)) {
            const resultItem = document.createElement("li");
            resultItem.textContent = result.title + (result.category ? " · " + result.category : "");
            resultList.append(resultItem);
          }
          item.append(resultList);
        }
        steps.append(item);
      }
      main.append(steps);

      const actions = document.createElement("div");
      actions.className = "workflow-actions";
      if (run.status === "waiting_review") {
        const continueButton = document.createElement("button");
        continueButton.type = "button";
        continueButton.className = "item-action";
        continueButton.textContent = "Continue";
        continueButton.addEventListener("click", async () => {
          if (!confirm("Continue this workflow after reviewing the completed steps?")) return;
          continueButton.disabled = true;
          try {
            const data = await api("/api/workflow-runs/" + encodeURIComponent(run.id) + "/continue", {
              method: "POST", body: JSON.stringify({})
            });
            state.workflowRuns = state.workflowRuns.map((item) => item.id === run.id ? data.run : item);
            renderWorkflows();
            toast(data.run.status === "completed" ? "Workflow completed." : "Workflow paused at another review checkpoint.");
          } catch (error) {
            toast(error.message, true);
            continueButton.disabled = false;
          }
        });
        actions.append(continueButton);
      }
      if (["running", "waiting_review"].includes(run.status)) {
        const stopButton = document.createElement("button");
        stopButton.type = "button";
        stopButton.className = "item-action";
        stopButton.textContent = "Stop";
        stopButton.addEventListener("click", async () => {
          if (!confirm("Stop this workflow? Remaining steps will not run.")) return;
          stopButton.disabled = true;
          try {
            const data = await api("/api/workflow-runs/" + encodeURIComponent(run.id) + "/stop", {
              method: "POST", body: JSON.stringify({})
            });
            state.workflowRuns = state.workflowRuns.map((item) => item.id === run.id ? data.run : item);
            renderWorkflows();
            toast("Workflow stopped.");
          } catch (error) {
            toast(error.message, true);
            stopButton.disabled = false;
          }
        });
        actions.append(stopButton);
      }
      if (run.logs?.length) {
        const logs = document.createElement("details");
        logs.className = "workflow-log-details";
        const summary = document.createElement("summary");
        summary.textContent = "Execution log (" + run.logs.length + ")";
        logs.append(summary);
        for (const entry of run.logs) {
          const line = document.createElement("div");
          line.className = "list-item-meta";
          line.textContent = new Date(entry.at).toLocaleTimeString() + " · " + entry.stepTitle + " · " + entry.summary;
          logs.append(line);
        }
        main.append(logs);
      }
      actions.classList.toggle("hidden", actions.childElementCount === 0);
      row.append(main, actions);
      runsTarget.append(row);
    }
  }
}

function renderTasks() {
  const target = $("#task-list");
  target.replaceChildren();
  $("#task-count").textContent = state.tasks.filter((item) => !item.done).length;
  if (!state.tasks.length) {
    target.append(makeEmpty("Your list is clear. Add one small next step above."));
    renderStorageOverview();
    return;
  }
  const sorted = [...state.tasks].sort((a, b) => Number(a.done) - Number(b.done) || String(b.createdAt).localeCompare(String(a.createdAt)));
  for (const item of sorted) {
    const row = document.createElement("article");
    row.className = "list-item" + (item.done ? " completed" : "");
    const check = document.createElement("input");
    check.className = "task-check";
    check.type = "checkbox";
    check.checked = Boolean(item.done);
    check.setAttribute("aria-label", "Mark task complete");
    check.addEventListener("change", async () => {
      try {
        await api("/api/tasks/" + encodeURIComponent(item.id), { method: "PATCH", body: JSON.stringify({ done: check.checked }) });
        item.done = check.checked;
        renderTasks();
      } catch (error) { check.checked = !check.checked; toast(error.message, true); }
    });
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = item.title;
    main.append(title);
    if (item.description) {
      const description = document.createElement("p");
      description.textContent = item.description;
      main.append(description);
    }
    if (item.dueAt) {
      const due = document.createElement("div");
      due.className = "list-item-meta";
      const parsed = new Date(item.dueAt);
      due.textContent = "Due: " + (Number.isNaN(parsed.getTime()) ? item.dueAt : parsed.toLocaleString());
      main.append(due);
    }
    const del = document.createElement("button");
    del.type = "button";
    del.className = "item-action";
    del.textContent = "Remove";
    del.addEventListener("click", async () => {
      if (!confirm("Remove this task?")) return;
      try {
        await api("/api/tasks/" + encodeURIComponent(item.id), { method: "DELETE" });
        state.tasks = state.tasks.filter((task) => task.id !== item.id);
        renderTasks();
        toast("Task removed.");
      } catch (error) { toast(error.message, true); }
    });
    row.append(check, main, del);
    target.append(row);
  }
  renderStorageOverview();
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#login-button");
  button.disabled = true;
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
    $("#password").value = "";
    showApp();
    await refreshState();
    toast("Workspace unlocked.");
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

$("#logout-button").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST", body: JSON.stringify({}) }); } catch { /* always return to sign-in */ }
  state.chats = [];
  state.memories = [];
  state.memoryTotal = 0;
  state.knowledge = [];
  state.knowledgeTotal = 0;
  state.research = [];
  state.skills = [];
  state.feedback = [];
  state.experiencePreferences = [];
  state.workflows = [];
  state.workflowRuns = [];
  state.workflowSteps = [];
  state.integrations = [];
  state.integrationResults = {};
  state.editingWorkflowId = null;
  state.tasks = [];
  renderStorageOverview();
  showLogin();
  toast("Signed out.");
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll(".prompt-card").forEach((button) => {
  button.addEventListener("click", () => {
    $("#chat-input").value = button.dataset.prompt || "";
    setView("chat");
    $("#chat-input").focus();
  });
});

function setVoiceButtonState(label, disabled = false) {
  const button = $("#voice-button");
  if (!button) return;
  button.innerHTML = "🎙 <span>" + label + "</span>";
  button.disabled = disabled;
}

$("#voice-button").addEventListener("click", () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast("This browser does not support voice input. Use JARVIS Companion's Speak once or hands-free control.");
    return;
  }
  if (activeRecognition) {
    activeRecognition.stop();
    return;
  }

  try {
    const recognition = new Recognition();
    activeRecognition = recognition;
    recognition.lang = "hi-IN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setVoiceButtonState("Listening…");
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (!transcript) {
        toast("No speech was detected. Please try again.");
        return;
      }
      $("#chat-input").value = transcript;
      $("#chat-form").requestSubmit();
    };
    recognition.onerror = (event) => {
      const messages = {
        "not-allowed": "Microphone permission was denied. Allow it in your browser settings.",
        "service-not-allowed": "This browser blocked microphone access.",
        "no-speech": "No speech was detected. Try speaking closer to the microphone.",
        "network": "Speech recognition needs a working internet connection."
      };
      toast(messages[event.error] || "Voice recognition failed: " + (event.error || "unknown error"), true);
    };
    recognition.onend = () => {
      if (activeRecognition === recognition) activeRecognition = null;
      setVoiceButtonState("Speak");
    };
    recognition.start();
  } catch (error) {
    activeRecognition = null;
    setVoiceButtonState("Speak");
    toast("Could not start voice input. Check browser microphone permission.", true);
  }
});

$("#clear-chat-button").addEventListener("click", async () => {
  if (!confirm("Clear this temporary conversation? Saved memories, tasks and research will stay.")) return;
  try {
    await api("/api/chat/history", { method: "DELETE" });
    state.chats = [];
    renderChats();
    toast("Temporary conversation cleared.");
  } catch (error) {
    toast(error.message, true);
  }
});

$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#chat-input");
  const button = $("#send-button");
  const message = input.value.trim();
  if (!message || button.disabled) return;
  input.value = "";
  button.disabled = true;
  const tempId = "pending-" + Date.now();
  state.chats.push({ id: tempId, role: "user", content: message, createdAt: new Date().toISOString() });
  renderChats();
  const waiting = document.createElement("article");
  waiting.className = "message assistant";
  const mark = document.createElement("div");
  mark.className = "message-mark";
  mark.textContent = "J";
  const wrap = document.createElement("div");
  wrap.className = "message-wrap";
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = "Thinking…";
  wrap.append(body);
  waiting.append(mark, wrap);
  $("#chat-messages").append(waiting);
  try {
    const data = await api("/api/chat", { method: "POST", body: JSON.stringify({ message }) });
    if ($("#speak-toggle").checked && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(data.answer);
      utterance.lang = /[\u0900-\u097F]/.test(data.answer) ? "hi-IN" : "en-IN";
      window.speechSynthesis.speak(utterance);
    }
    await refreshState();
  } catch (error) {
    waiting.remove();
    const err = document.createElement("article");
    err.className = "message assistant";
    const errorMark = document.createElement("div");
    errorMark.className = "message-mark";
    errorMark.textContent = "!";
    const errorWrap = document.createElement("div");
    errorWrap.className = "message-wrap";
    const errorBody = document.createElement("div");
    errorBody.className = "message-body";
    errorBody.textContent = error.message;
    errorWrap.append(errorBody);
    err.append(errorMark, errorWrap);
    $("#chat-messages").append(err);
    toast(error.message, true);
  } finally {
    button.disabled = false;
    input.focus();
  }
});

$("#chat-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

$("#memory-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const data = await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({ content: $("#memory-content").value, category: $("#memory-category").value })
    });
    $("#memory-content").value = "";
    await refreshMemories("", "");
    toast(data.duplicate ? "That memory is already saved." : "Memory saved.");
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

$("#memory-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await refreshMemories($("#memory-search-input").value, $("#memory-category-filter").value);
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

$("#export-data-button").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const data = await api("/api/export");
    const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "jarvis-personal-data.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Your JARVIS data export is ready.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#skill-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const wasEditing = Boolean(state.editingSkillId);
  const button = $("#skill-submit-button");
  button.disabled = true;
  const payload = {
    name: $("#skill-name").value.trim(),
    instructions: $("#skill-instructions").value.trim(),
    triggers: $("#skill-triggers").value.split(",").map((item) => item.trim()).filter(Boolean),
    testCases: [
      { input: $("#skill-positive-test").value.trim(), shouldMatch: true },
      { input: $("#skill-negative-test").value.trim(), shouldMatch: false }
    ]
  };
  try {
    const url = state.editingSkillId
      ? "/api/skills/" + encodeURIComponent(state.editingSkillId)
      : "/api/skills";
    const data = await api(url, {
      method: state.editingSkillId ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    if (state.editingSkillId) {
      state.skills = state.skills.map((item) => item.id === data.skill.id ? data.skill : item);
    } else {
      state.skills.push(data.skill);
    }
    resetSkillForm();
    renderSkills();
    toast(wasEditing
      ? "New draft version saved. The previously approved version remains active."
      : "Skill draft saved. Run its tests before approving it.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

function resetSkillForm() {
  state.editingSkillId = null;
  $("#skill-form").reset();
  $("#skill-form-title").textContent = "Create a skill draft";
  $("#skill-submit-button").textContent = "Save draft";
  $("#skill-cancel-edit").classList.add("hidden");
}

$("#skill-cancel-edit").addEventListener("click", resetSkillForm);

$("#workflow-step-type").addEventListener("change", () => {
  const type = $("#workflow-step-type").value;
  const labels = {
    create_task: ["Task details (optional)", "Add a short reminder or details for the task…"],
    save_memory: ["Memory content", "Write the fact, preference, or goal to save…"],
    search_knowledge: ["Search query", "Example: mole concept or circular motion…"],
    draft_text: ["Draft text", "Write the text to prepare locally. It will not be sent or published…"],
    review_checkpoint: ["Review note (optional)", "What should you review before continuing?…"],
    github_list_repositories: ["No input required", "This read-only integration uses the configured GitHub connection."],
    google_drive_list_files: ["No input required", "This read-only integration uses the configured Google Drive connection."],
    telegram_get_bot_profile: ["No input required", "This read-only integration uses the configured Telegram bot."],
    elevenlabs_get_account: ["No input required", "This read-only integration uses the configured ElevenLabs connection."]
  };
  const label = labels[type];
  const integrationAction = type.startsWith("github_") || type.startsWith("google_drive_") ||
    type.startsWith("telegram_") || type.startsWith("elevenlabs_");
  $("#workflow-step-value-label").textContent = label[0];
  $("#workflow-step-value").placeholder = label[1];
  $("#workflow-step-value").disabled = integrationAction;
  $("#workflow-step-category").disabled = type !== "save_memory";
});

$("#workflow-add-step").addEventListener("click", () => {
  if (state.workflowSteps.length >= 10) {
    toast("A workflow can contain at most 10 steps.", true);
    return;
  }
  const type = $("#workflow-step-type").value;
  const title = $("#workflow-step-title").value.trim();
  const value = $("#workflow-step-value").value.trim();
  if (title.length < 3) {
    toast("Enter a step title with at least 3 characters.", true);
    return;
  }
  let step;
  if (type === "create_task") step = { type, title, description: value };
  else if (type === "save_memory") step = { type, title, content: value, category: $("#workflow-step-category").value };
  else if (type === "search_knowledge") step = { type, title, query: value };
  else if (type === "draft_text") step = { type, title, content: value };
  else if (["github_list_repositories", "google_drive_list_files", "telegram_get_bot_profile", "elevenlabs_get_account"].includes(type)) step = { type, title };
  else step = { type, title, message: value };
  state.workflowSteps.push(step);
  $("#workflow-step-title").value = "";
  $("#workflow-step-value").value = "";
  renderWorkflowBuilderSteps();
  toast("Workflow step added to the draft builder.");
});

$("#workflow-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.workflowSteps.length < 1) {
    toast("Add at least one workflow step before saving.", true);
    return;
  }
  const wasEditing = Boolean(state.editingWorkflowId);
  const button = $("#workflow-save-button");
  button.disabled = true;
  const payload = {
    name: $("#workflow-name").value.trim(),
    description: $("#workflow-description").value.trim(),
    steps: state.workflowSteps.map((step) => ({ ...step }))
  };
  try {
    const url = wasEditing
      ? "/api/workflows/" + encodeURIComponent(state.editingWorkflowId)
      : "/api/workflows";
    const data = await api(url, {
      method: wasEditing ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    if (wasEditing) {
      state.workflows = state.workflows.map((item) => item.id === data.workflow.id ? data.workflow : item);
    } else {
      state.workflows.unshift(data.workflow);
    }
    resetWorkflowForm();
    renderWorkflows();
    toast(wasEditing
      ? "New workflow draft version saved. Validate and approve it again before running."
      : "Workflow draft saved. Validate and approve it before running.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

function resetWorkflowForm() {
  state.editingWorkflowId = null;
  state.workflowSteps = [];
  $("#workflow-form").reset();
  $("#workflow-form-title").textContent = "Create a workflow draft";
  $("#workflow-save-button").textContent = "Save workflow draft";
  $("#workflow-cancel-edit").classList.add("hidden");
  $("#workflow-step-category").disabled = true;
  $("#workflow-step-value").disabled = false;
  $("#workflow-step-type").value = "create_task";
  $("#workflow-step-type").dispatchEvent(new Event("change"));
  renderWorkflowBuilderSteps();
}

$("#workflow-cancel-edit").addEventListener("click", resetWorkflowForm);


$("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const data = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: $("#task-title").value,
        description: $("#task-description").value,
        dueAt: $("#task-due").value
      })
    });
    state.tasks.push(data.task);
    $("#task-title").value = "";
    $("#task-description").value = "";
    $("#task-due").value = "";
    renderTasks();
    toast("Task added.");
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});

function safeResearchUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function renderGroundedResearch(item, canSave = true) {
  const target = $("#search-results");
  target.replaceChildren();
  const card = document.createElement("article");
  card.className = "result-card";

  const heading = document.createElement("strong");
  heading.textContent = item.engine === "saved-research" ? "Saved research" : "Live web research";
  const question = document.createElement("p");
  question.textContent = item.query || "";
  const answer = document.createElement("p");
  answer.className = "research-answer";
  answer.textContent = item.answer || "No answer was returned.";
  const meta = document.createElement("div");
  meta.className = "research-meta";
  meta.textContent = item.searchedAt ? "Searched " + new Date(item.searchedAt).toLocaleString() : "Saved research · not a new web search";

  card.append(heading, question, meta, answer);
  const sources = Array.isArray(item.sources) ? item.sources : [];
  if (!sources.length) {
    const note = document.createElement("p");
    note.className = "research-citations";
    note.textContent = "No live source citations were attached to this answer. Treat it as unverified.";
    card.append(note);
  } else {
    const sourceHeading = document.createElement("p");
    sourceHeading.className = "research-citations";
    sourceHeading.textContent = "Grounding sources (" + sources.length + ")";
    const sourceList = document.createElement("div");
    sourceList.className = "research-sources";
    for (const source of sources) {
      const url = safeResearchUrl(source.url);
      if (!url) continue;
      const row = document.createElement("div");
      row.className = "research-source";
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = source.title || source.domain || "Open source";
      const domain = document.createElement("span");
      domain.textContent = source.domain || new URL(url).hostname;
      row.append(anchor, domain);
      sourceList.append(row);
    }
    card.append(sourceHeading, sourceList);
  }

  const evidence = Array.isArray(item.citations) ? item.citations.slice(0, 12) : [];
  if (evidence.length) {
    const evidenceHeading = document.createElement("p");
    evidenceHeading.className = "research-citations";
    evidenceHeading.textContent = "Claim-level source support";
    const evidenceList = document.createElement("div");
    evidenceList.className = "research-sources";
    for (const citation of evidence) {
      const row = document.createElement("div");
      row.className = "research-source";
      const claim = document.createElement("span");
      claim.textContent = citation.claim || "Supported claim";
      row.append(claim);
      const citedUrls = Array.isArray(citation.sourceUrls) ? citation.sourceUrls.slice(0, 5) : [];
      for (const rawUrl of citedUrls) {
        const url = safeResearchUrl(rawUrl);
        if (!url) continue;
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = "Supporting source: " + new URL(url).hostname;
        row.append(anchor);
      }
      evidenceList.append(row);
    }
    card.append(evidenceHeading, evidenceList);
  }

  if (canSave && item.engine !== "saved-research") {
    const actions = document.createElement("div");
    actions.className = "research-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "item-action";
    save.textContent = "Save research";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const data = await api("/api/research/saved", {
          method: "POST",
          body: JSON.stringify({
            query: item.query,
            answer: item.answer,
            sources: item.sources || [],
            citations: item.citations || [],
            searchedAt: item.searchedAt
          })
        });
        state.research.unshift(data.item);
        renderSavedResearch();
        save.textContent = "Saved";
        toast("Research saved to your private JARVIS history.");
      } catch (error) {
        save.disabled = false;
        toast(error.message, true);
      }
    });

    const addKnowledge = document.createElement("button");
    addKnowledge.type = "button";
    addKnowledge.className = "item-action";
    addKnowledge.textContent = "Save to Knowledge";
    addKnowledge.addEventListener("click", async () => {
      addKnowledge.disabled = true;
      try {
        const data = await api("/api/knowledge", {
          method: "POST",
          body: JSON.stringify({
            title: item.query || "Saved research",
            content: item.answer || "",
            category: "general",
            sourceKind: "web-research",
            sourceQuery: item.query || "",
            sources: item.sources || [],
            citations: item.citations || []
          })
        });
        await refreshKnowledge(state.knowledgeQuery);
        addKnowledge.textContent = data.duplicate ? "Already saved" : "Added to Knowledge";
        toast(data.duplicate ? "This knowledge entry is already saved." : "Research added to your Knowledge Library. Check its sources before marking it reviewed.");
      } catch (error) {
        addKnowledge.disabled = false;
        toast(error.message, true);
      }
    });

    actions.append(save, addKnowledge);
    card.append(actions);
  }
  target.append(card);
}

function renderKnowledge() {
  const target = $("#knowledge-list");
  if (!target) return;
  target.replaceChildren();
  const count = $("#knowledge-count");
  if (count) count.textContent = state.knowledgeTotal + " saved";

  if (!state.knowledge.length) {
    target.append(makeEmpty("No saved knowledge yet. Add a note or use “Save to Knowledge” on a research result."));
    return;
  }

  for (const item of state.knowledge) {
    const row = document.createElement("article");
    row.className = "list-item";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = item.title || "Untitled knowledge";
    const description = document.createElement("p");
    description.textContent = item.content || "";
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    const sourceLabel = item.sourceKind === "web-research" ? "Saved web research" : "Your note";
    const reviewLabel = item.reviewStatus === "user-reviewed"
      ? "Sources reviewed by you"
      : item.reviewStatus === "unreviewed" ? "Not yet reviewed" : "User-authored";
    meta.textContent = [
      item.category || "general",
      sourceLabel,
      reviewLabel,
      item.createdAt ? new Date(item.createdAt).toLocaleString() : ""
    ].filter(Boolean).join(" · ");
    main.append(title, description, meta);

    if (Array.isArray(item.tags) && item.tags.length) {
      const tags = document.createElement("div");
      tags.className = "list-item-meta";
      tags.textContent = "Tags: " + item.tags.join(", ");
      main.append(tags);
    }

    if (Array.isArray(item.sources) && item.sources.length) {
      const sourceList = document.createElement("div");
      sourceList.className = "research-sources";
      for (const source of item.sources.slice(0, 6)) {
        const url = safeResearchUrl(source.url);
        if (!url) continue;
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = source.title || source.domain || new URL(url).hostname;
        sourceList.append(anchor);
      }
      main.append(sourceList);
    }

    const actions = document.createElement("div");
    actions.className = "device-actions";
    if (item.sourceKind === "web-research" && item.reviewStatus !== "user-reviewed") {
      const review = document.createElement("button");
      review.type = "button";
      review.className = "item-action";
      review.textContent = "Mark reviewed";
      review.addEventListener("click", async () => {
        review.disabled = true;
        try {
          await api("/api/knowledge/" + encodeURIComponent(item.id), {
            method: "PATCH",
            body: JSON.stringify({ reviewStatus: "user-reviewed" })
          });
          await refreshKnowledge(state.knowledgeQuery);
          toast("Marked as reviewed by you. This does not mean JARVIS independently verified every claim.");
        } catch (error) {
          review.disabled = false;
          toast(error.message, true);
        }
      });
      actions.append(review);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "item-action";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await api("/api/knowledge/" + encodeURIComponent(item.id), { method: "DELETE" });
        await refreshKnowledge(state.knowledgeQuery);
        toast("Knowledge entry deleted.");
      } catch (error) {
        remove.disabled = false;
        toast(error.message, true);
      }
    });
    actions.append(remove);
    row.append(main, actions);
    target.append(row);
  }
}

async function refreshKnowledge(query = state.knowledgeQuery) {
  state.knowledgeQuery = String(query || "").trim();
  const suffix = state.knowledgeQuery ? "?q=" + encodeURIComponent(state.knowledgeQuery) : "";
  const data = await api("/api/knowledge" + suffix);
  state.knowledge = Array.isArray(data.items) ? data.items : [];
  state.knowledgeTotal = Number(data.total) || 0;
  renderKnowledge();
  renderStorageOverview();
}

function renderSavedResearch() {
  const target = $("#saved-research-list");
  if (!target) return;
  target.replaceChildren();
  if (!state.research.length) {
    target.append(makeEmpty("Nothing saved yet. Live research is never saved automatically."));
    renderStorageOverview();
    return;
  }

  for (const item of state.research) {
    const row = document.createElement("article");
    row.className = "list-item";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = item.query || "Saved research";
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    meta.textContent = (item.sources?.length || 0) + " source(s) · Saved " + new Date(item.createdAt).toLocaleString();
    main.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "device-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "item-action";
    open.textContent = "View";
    open.addEventListener("click", () => {
      renderGroundedResearch({ ...item, engine: "saved-research" }, false);
      $("#search-results").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "item-action";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await api("/api/research/saved/" + encodeURIComponent(item.id), { method: "DELETE" });
        state.research = state.research.filter((saved) => saved.id !== item.id);
        renderSavedResearch();
        toast("Saved research deleted.");
      } catch (error) {
        remove.disabled = false;
        toast(error.message, true);
      }
    });
    actions.append(open, remove);
    row.append(main, actions);
    target.append(row);
  }
  renderStorageOverview();
}

$("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = $("#search-input").value.trim();
  const offlineButton = $("#search-button");
  const webButton = $("#web-research-button");
  const useWeb = event.submitter?.id === "web-research-button";
  const target = $("#search-results");
  offlineButton.disabled = true;
  webButton.disabled = true;
  target.replaceChildren();
  target.append(makeEmpty(useWeb
    ? "Searching the live web and checking source citations…"
    : "Searching the embedded offline knowledge base…"));

  try {
    if (useWeb) {
      const data = await api("/api/research", {
        method: "POST",
        body: JSON.stringify({ query })
      });
      renderGroundedResearch(data);
    } else {
      const data = await api("/api/search?q=" + encodeURIComponent(query.slice(0, 300)));
      target.replaceChildren();
      if (!data.results.length) target.append(makeEmpty("No results were returned for that query."));
      for (const result of data.results) {
        const card = document.createElement("article");
        card.className = "result-card";
        const title = document.createElement("strong");
        title.textContent = result.title;
        const snippet = document.createElement("p");
        snippet.textContent = result.snippet || "No description available.";
        card.append(title, snippet);
        if (result.source === "saved-knowledge") {
          const meta = document.createElement("div");
          meta.className = "research-meta";
          meta.textContent = "Saved knowledge · " + (result.reviewStatus === "user-reviewed" ? "reviewed by you" : "not independently verified");
          card.append(meta);
          for (const source of (result.sources || []).slice(0, 4)) {
            const url = safeResearchUrl(source.url);
            if (!url) continue;
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            anchor.textContent = "Source: " + (source.title || new URL(url).hostname);
            card.append(anchor);
          }
        }
        target.append(card);
      }
    }
  } catch (error) {
    target.replaceChildren();
    target.append(makeEmpty(error.message));
    toast(error.message, true);
  } finally {
    offlineButton.disabled = false;
    webButton.disabled = false;
  }
});

$("#knowledge-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await refreshKnowledge($("#knowledge-search-input").value);
    if (state.knowledgeQuery && !state.knowledge.length) toast("No saved knowledge matched that search.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#knowledge-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const data = await api("/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        title: $("#knowledge-title").value.trim(),
        content: $("#knowledge-content").value.trim(),
        category: $("#knowledge-category").value,
        tags: $("#knowledge-tags").value,
        sourceKind: "manual"
      })
    });
    await refreshKnowledge("");
    event.currentTarget.reset();
    toast(data.duplicate ? "That note is already in your Knowledge Library." : "Knowledge note saved.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#voice-button").addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast("Voice input is not supported in this browser. You can type your message instead.", true);
    return;
  }
  const button = $("#voice-button");
  const recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  button.disabled = true;
  button.textContent = "Listening…";
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    $("#chat-input").value = ($("#chat-input").value + " " + transcript).trim();
    $("#chat-input").focus();
  };
  recognition.onerror = () => toast("Voice input was unavailable. Check browser microphone permissions.", true);
  recognition.onend = () => {
    button.disabled = false;
    button.innerHTML = "🎙 <span>Voice</span>";
  };
  try { recognition.start(); } catch {
    button.disabled = false;
    button.innerHTML = "🎙 <span>Voice</span>";
    toast("Could not start voice input.", true);
  }
});


async function refreshDevices() {
  const data = await api("/api/devices");
  state.devices = Array.isArray(data.devices) ? data.devices : [];
  renderDevices();
}

function renderDevices() {
  const target = $("#device-list");
  if (!target) return;
  target.replaceChildren();
  if (!state.devices.length) {
    target.append(makeEmpty("No paired devices yet. Generate a code above to connect your Android Companion."));
    return;
  }

  for (const device of state.devices) {
    const row = document.createElement("article");
    row.className = "list-item";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = device.name || device.model || "Android device";
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    const modelText = [device.manufacturer, device.model].filter(Boolean).join(" ");
    const lastSeen = device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "Not checked in yet";
    meta.textContent = [modelText, "Last seen: " + lastSeen, device.accessibilityEnabled ? "Accessibility enabled" : "Accessibility not enabled"].filter(Boolean).join(" · ");
    main.append(title, meta);

    const status = document.createElement("span");
    status.className = "device-status";
    status.textContent = device.revokedAt ? "Revoked" : "Paired";
    if (device.revokedAt) status.classList.add("revoked");

    const actions = document.createElement("div");
    actions.className = "device-actions";
    actions.append(status);
    if (!device.revokedAt) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "item-action";
      revoke.textContent = "Revoke";
      revoke.addEventListener("click", async () => {
        if (!confirm("Revoke this device? Its saved device credential will stop working.")) return;
        revoke.disabled = true;
        try {
          await api("/api/devices/" + encodeURIComponent(device.id), { method: "DELETE" });
          await refreshDevices();
          toast("Device access revoked.");
        } catch (error) {
          toast(error.message, true);
          revoke.disabled = false;
        }
      });
      actions.append(revoke);
    }
    row.append(main, actions);
    target.append(row);
  }
}

async function generatePairingCode() {
  const button = $("#create-pairing-code");
  const panel = $("#pairing-code-panel");
  button.disabled = true;
  try {
    const data = await api("/api/devices/pairing-challenges", {
      method: "POST",
      body: JSON.stringify({})
    });
    $("#pairing-code-value").textContent = data.code;
    $("#pairing-code-expiry").textContent = "Expires: " + new Date(data.expiresAt).toLocaleTimeString();
    panel.classList.remove("hidden");
    toast("One-time pairing code created.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

$("#create-pairing-code").addEventListener("click", generatePairingCode);
$("#refresh-devices").addEventListener("click", () => refreshDevices().catch((error) => toast(error.message, true)));

boot();
