import { createVoiceController } from "./voice-controller.js";
import { createOrbitalVisual } from "./orbital-visual.js";
const $ = (selector) => document.querySelector(selector);
const state = { chats: [], memories: [], memoryTotal: 0, memoryQuery: "", memoryCategory: "", tasks: [], feedback: [], experiencePreferences: [], skills: [], editingSkillId: null, workflows: [], workflowRuns: [], workflowSteps: [], editingWorkflowId: null, integrations: [], integrationResults: {}, googleDriveOAuth: null, integrationPermissions: [], externalActions: [], actionCapabilities: null, devices: [], research: [], knowledge: [], knowledgeTotal: 0, knowledgeQuery: "", knowledgeFilter: "all", knowledgeSummary: { total: 0, trusted: 0, unreviewed: 0, rejected: 0 }, diagnostics: null, activeView: "chat" };
let toastTimer;

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
    const params = new URLSearchParams(window.location.search);
    if (params.get("integration") === "google_drive_connected" && params.get("capability") === "create_docs") {
      toast("Google Drive connected. New Google Docs can now be created after preview and confirmation.");
    } else if (params.get("integration") === "google_drive_connected") {
      toast("Google Drive connected with read-only metadata access.");
    } else if (params.get("integration") === "google_drive_error") {
      toast("Google Drive was not connected. Check the OAuth setup and try again.", true);
    }
    if (params.has("integration")) window.history.replaceState({}, "", window.location.pathname);
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
  const actionData = await api("/api/actions");
  const actionCapabilities = await api("/api/actions/capabilities");
  state.externalActions = actionData.actions || [];
  state.actionCapabilities = actionCapabilities;
  state.integrations = integrationData.providers || [];
  state.googleDriveOAuth = integrationData.googleDriveOAuth || null;
  state.integrationPermissions = integrationData.permissions || [];
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
  renderExternalActions();
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
    integrations: ["CONNECTED SERVICES", "Connections"],
    actions: ["CONTROLLED ACTIONS", "Action Center"],
    system: ["SYSTEM READINESS", "System Status"]
  };
  $("#page-kicker").textContent = titles[name][0];
  $("#page-title").textContent = titles[name][1];
  if (name !== "chat" && voiceModeActive) stopHandsFreeMode();
  if (name === "chat") setTimeout(() => $("#chat-input").focus(), 0);
  $("#app-shell").classList.remove("menu-open");
  $("#menu-toggle")?.setAttribute("aria-expanded", "false");
  if (name === "devices") refreshDevices().catch((error) => toast(error.message, true));
  if (name === "memory") refreshMemories().catch((error) => toast(error.message, true));
  if (name === "workflows") refreshWorkflows().catch((error) => toast(error.message, true));
  if (name === "integrations") refreshIntegrations().catch((error) => toast(error.message, true));
  if (name === "actions") refreshExternalActions().catch((error) => toast(error.message, true));
  if (name === "system") refreshSystemDiagnostics().catch((error) => toast(error.message, true));
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
  const messages = state.chats.slice(-6);
  if (!messages.length) {
    $("#chat-messages").classList.add("hidden");
    
    return;
  }
  $("#chat-messages").classList.remove("hidden");
  
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
    if (item.role === "assistant" && item.externalSearch) time.textContent += " · Web sources";
    else if (item.role === "assistant" && item.externalAI) time.textContent += " · Online answer";
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
    meta.textContent = (item.category || "fact") + " · Saved " + created + updated + (item.enabled === false ? " · Paused in chat" : "");
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

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "item-action";
    toggle.textContent = item.enabled === false ? "Resume in chat" : "Pause in chat";
    toggle.setAttribute("aria-pressed", item.enabled === false ? "true" : "false");
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      try {
        await api("/api/memories/" + encodeURIComponent(item.id), {
          method: "PATCH",
          body: JSON.stringify({ enabled: item.enabled === false })
        });
        await refreshMemories(state.memoryQuery, state.memoryCategory);
        toast(item.enabled === false ? "Memory resumed in chat context." : "Memory paused; it remains saved.");
      } catch (error) {
        toast(error.message, true);
        toggle.disabled = false;
      }
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

    actions.append(edit, toggle, remove);
    row.append(main, actions);
    target.append(row);
  }
  renderStorageOverview();
}

function renderMemoryContextPreview(preview) {
  const target = $("#memory-preview-results");
  const status = $("#memory-preview-status");
  if (!target || !status) return;
  target.replaceChildren();
  const items = Array.isArray(preview?.items) ? preview.items : [];
  const pausedCount = Number(preview?.pausedCount) || 0;
  if (items.length) {
    status.textContent = items.length + " enabled note" + (items.length === 1 ? "" : "s") + " would be included, ranked by relevance.";
  } else {
    status.textContent = "No enabled memory matched this prompt.";
  }
  if (pausedCount > 0) {
    status.textContent += " " + pausedCount + " matching paused note" + (pausedCount === 1 ? " was" : "s were") + " excluded.";
  }
  for (const item of items) {
    const row = document.createElement("article");
    row.className = "list-item";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = item.content || "";
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    const matched = Array.isArray(item.matchedTerms) ? item.matchedTerms.join(", ") : "";
    meta.textContent = (item.category || "fact") + (matched ? " · Matched: " + matched : "");
    main.append(title, meta);
    row.append(main);
    target.append(row);
  }
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
      if (!confirm("Approve this skill version and let it guide matching online AI requests?")) return;
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
        toast("Skill paused. It will no longer be added to matching online AI requests.");
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
      meta.textContent = (preference.active ? "Active in online AI context" : "Paused") +
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
          if (!confirm("Approve this suggestion as a response preference for future matching online AI conversations?")) return;
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
  state.googleDriveOAuth = data.googleDriveOAuth || null;
  state.integrationPermissions = data.permissions || [];
  renderIntegrations();
}

function integrationDetailText(provider, result) {
  const details = result?.details || {};
  if (provider === "google_drive" && state.googleDriveOAuth?.connected) {
    return "Google OAuth connected · Read-only metadata scope · Token refresh is handled by JARVIS.";
  }
  if (provider === "github") {
    return details.latestRepository
      ? "Repository metadata access verified · Latest: " + details.latestRepository
      : "GitHub connection verified · No repositories returned.";
  }
  if (provider === "google_drive") return "Connection verified · " + (details.recentFiles ?? 0) + " recent files listed.";
  if (provider === "telegram") return details.username ? "Connected to bot @" + details.username : "Telegram bot connection verified.";
  if (provider === "elevenlabs") return "Account verified · Plan: " + (details.tier || "unknown");
  return "Connection verified.";
}

async function refreshExternalActions() {
  const [actionsData, capabilities] = await Promise.all([
    api("/api/actions"),
    api("/api/actions/capabilities")
  ]);
  state.externalActions = actionsData.actions || [];
  state.actionCapabilities = capabilities;
  renderExternalActions();
}

function updateExternalActionFields() {
  const type = $("#external-action-type")?.value || "telegram_send_message";
  const telegram = type === "telegram_send_message";
  $("#action-telegram-fields")?.classList.toggle("hidden", !telegram);
  $("#action-google-fields")?.classList.toggle("hidden", telegram);
  const capabilities = state.actionCapabilities || {};
  const chatSelect = $("#action-telegram-chat");
  if (chatSelect) {
    const allowlist = capabilities.telegram?.allowedChatIds || [];
    const selected = chatSelect.value;
    chatSelect.replaceChildren();
    for (const chatId of allowlist) {
      const option = document.createElement("option");
      option.value = chatId;
      option.textContent = "Allowed chat · " + chatId;
      chatSelect.append(option);
    }
    if (allowlist.includes(selected)) chatSelect.value = selected;
    chatSelect.disabled = !capabilities.telegram?.enabled || allowlist.length === 0;
  }
  const docsPermission = $("#action-google-permission");
  if (docsPermission) {
    docsPermission.classList.toggle("hidden", Boolean(capabilities.googleDrive?.canCreateDocs));
    docsPermission.disabled = !state.googleDriveOAuth?.canConnect || !capabilities.googleDrive?.connected;
  }
  const submit = $("#external-action-submit");
  if (submit) {
    const allowed = telegram
      ? Boolean(capabilities.telegram?.enabled && capabilities.telegram?.allowedChatIds?.length)
      : Boolean(capabilities.googleDrive?.canCreateDocs);
    submit.disabled = !allowed;
    submit.textContent = telegram ? "Create message preview" : "Create document preview";
  }
}

async function startGoogleDocsPermissionUpgrade() {
  const button = $("#action-google-permission");
  if (!state.googleDriveOAuth?.canConnect) {
    toast("Configure Google OAuth client and token-vault settings in the server environment first.", true);
    return;
  }
  button.disabled = true;
  try {
    const data = await api("/api/integrations/google_drive/oauth/start", {
      method: "POST",
      body: JSON.stringify({ capability: "create_docs" })
    });
    window.location.href = data.launchUrl;
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
  }
}

function renderExternalActions() {
  const list = $("#external-action-list");
  if (!list) return;
  const capabilities = state.actionCapabilities || {};
  const summary = $("#action-capability-summary");
  if (summary) {
    summary.replaceChildren();
    const telegram = document.createElement("p");
    const allowedChats = capabilities.telegram?.allowedChatIds || [];
    telegram.textContent = capabilities.telegram?.enabled
      ? "Telegram: ready · " + allowedChats.length + " allow-listed destination(s)."
      : "Telegram: not enabled. Add the bot token and numeric chat allow-list on the server.";
    const google = document.createElement("p");
    google.textContent = capabilities.googleDrive?.canCreateDocs
      ? "Google Docs: ready · JARVIS can create new documents only."
      : "Google Docs: needs a Google Drive connection with the separate drive.file permission.";
    summary.append(telegram, google);
  }
  updateExternalActionFields();
  list.replaceChildren();
  if (!state.externalActions.length) {
    list.append(makeEmpty("No action previews yet. Create a preview above; nothing happens until you confirm it."));
    return;
  }
  for (const action of state.externalActions) {
    const card = document.createElement("article");
    card.className = "list-item controlled-action-card";
    const main = document.createElement("div");
    main.className = "list-item-main";
    const title = document.createElement("strong");
    title.textContent = action.title;
    const status = document.createElement("span");
    status.className = "integration-status " + (action.status === "completed" ? "connected" : action.status === "pending" ? "configured" : action.status === "failed" ? "connection-failed" : "");
    status.textContent = action.status.replaceAll("_", " ");
    const meta = document.createElement("div");
    meta.className = "list-item-meta";
    meta.textContent = action.provider === "telegram"
      ? "Telegram chat ID: " + action.chatId
      : "Google Drive · new document: " + action.documentTitle;
    const preview = document.createElement("pre");
    preview.className = "action-preview-text";
    preview.textContent = action.provider === "telegram" ? action.text : action.content;
    main.append(title, status, meta, preview);
    const history = document.createElement("div");
    history.className = "action-history";
    for (const event of (action.statusHistory || []).slice(-4)) {
      const line = document.createElement("p");
      line.textContent = new Date(event.at).toLocaleString() + " · " + event.summary;
      history.append(line);
    }
    main.append(history);
    if (action.result?.documentUrl) {
      const link = document.createElement("a");
      link.href = action.result.documentUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open created Google Doc";
      main.append(link);
    }
    if (action.result?.messageId) {
      const sent = document.createElement("p");
      sent.className = "integration-success";
      sent.textContent = "Telegram message ID: " + action.result.messageId;
      main.append(sent);
    }
    if (action.status === "pending") {
      const expiry = document.createElement("p");
      expiry.className = "list-item-meta";
      expiry.textContent = "Expires: " + new Date(action.expiresAt).toLocaleTimeString();
      main.append(expiry);
    }
    const controls = document.createElement("div");
    controls.className = "integration-actions";
    if (action.status === "pending") {
      const execute = document.createElement("button");
      execute.type = "button";
      execute.className = "primary action-confirm-button";
      execute.textContent = "Confirm & " + (action.provider === "telegram" ? "send" : "create");
      execute.addEventListener("click", async () => {
        const entered = window.prompt("Review the preview. Type exactly: " + action.confirmationPhrase);
        if (entered === null) return;
        execute.disabled = true;
        try {
          await api("/api/actions/" + encodeURIComponent(action.id) + "/execute", {
            method: "POST",
            body: JSON.stringify({ confirmation: entered })
          });
          await refreshExternalActions();
          toast(action.provider === "telegram" ? "Telegram message sent." : "Google Doc created.");
        } catch (error) {
          await refreshExternalActions();
          toast(error.message, true);
        }
      });
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "item-action";
      cancel.textContent = "Cancel preview";
      cancel.addEventListener("click", async () => {
        cancel.disabled = true;
        try {
          await api("/api/actions/" + encodeURIComponent(action.id) + "/cancel", {
            method: "POST",
            body: JSON.stringify({})
          });
          await refreshExternalActions();
          toast("Preview cancelled. Nothing was sent or created.");
        } catch (error) {
          toast(error.message, true);
          cancel.disabled = false;
        }
      });
      controls.append(execute, cancel);
    }
    card.append(main, controls);
    list.append(card);
  }
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
    const googleOAuthConnected = provider.id === "google_drive" && state.googleDriveOAuth?.connected;
    status.className = "integration-status " + (googleOAuthConnected || lastResult?.connected ? "connected" : lastResult?.error ? "connection-failed" : provider.disabled ? "connection-disabled" : provider.configured ? "configured" : "not-configured");
    status.textContent = googleOAuthConnected ? "Connected via Google OAuth" : provider.id === "google_drive" && state.googleDriveOAuth?.canConnect ? "Ready to connect" : lastResult?.connected ? "Connected" : lastResult?.error ? "Test failed" : provider.disabled ? "Disabled in JARVIS" : provider.configured ? "Configured · not tested" : "Not configured";
    const access = document.createElement("p");
    access.textContent = provider.access;
    const variable = document.createElement("code");
    variable.textContent = provider.id === "google_drive"
      ? provider.oauthConnected ? "Google OAuth · encrypted refresh token" : provider.authMethod
      : provider.environmentVariable;
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
    test.disabled = !provider.enabled || (provider.id === "google_drive" && !provider.oauthConnected && !provider.environmentConfigured);
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

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "item-action";
    toggle.textContent = !provider.configured ? "Add credential first" : provider.enabled ? "Disable in JARVIS" : "Enable in JARVIS";
    toggle.disabled = !provider.configured;
    toggle.addEventListener("click", async () => {
      toggle.disabled = true;
      const action = provider.enabled ? "disable" : "enable";
      try {
        const data = await api("/api/integrations/" + encodeURIComponent(provider.id) + "/" + action, {
          method: "POST",
          body: JSON.stringify({})
        });
        state.integrations = data.providers || [];
        state.googleDriveOAuth = data.googleDriveOAuth || null;
        state.integrationPermissions = data.permissions || [];
        delete state.integrationResults[provider.id];
        renderIntegrations();
        toast(provider.enabled ? provider.name + " disabled in JARVIS." : provider.name + " enabled in JARVIS.");
      } catch (error) {
        toast(error.message, true);
        toggle.disabled = false;
      }
    });
    actions.append(test, toggle);
    const connect = document.createElement("button");
    connect.type = "button";
    connect.className = "item-action";
    connect.textContent = state.googleDriveOAuth.connected ? "Reconnect Google Drive" : "Connect Google Drive";
    connect.disabled = !provider.enabled;
    connect.addEventListener("click", async () => {
      connect.disabled = true;
      try {
        const data = await api("/api/integrations/google_drive/oauth/start", { method: "POST", body: JSON.stringify({}) });
        window.location.href = data.launchUrl;
      } catch (error) {
        toast(error.message, true);
        connect.disabled = false;
      }
    });
    if (provider.id === "google_drive" && state.googleDriveOAuth?.canConnect) actions.append(connect);
    if (provider.id === "google_drive" && state.googleDriveOAuth?.connected) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.className = "item-action";
      revoke.textContent = "Revoke Google access";
      revoke.addEventListener("click", async () => {
        if (!confirm("Revoke Google Drive permission and remove the saved JARVIS credential? Google may also revoke tokens for other OAuth clients in the same Google Cloud project.")) return;
        revoke.disabled = true;
        try {
          const data = await api("/api/integrations/google_drive/oauth/revoke", { method: "POST", body: JSON.stringify({}) });
          state.integrations = data.providers || [];
          state.googleDriveOAuth = data.googleDriveOAuth || null;
          state.integrationPermissions = data.permissions || [];
          delete state.integrationResults.google_drive;
          renderIntegrations();
          toast("Google Drive access revoked.");
        } catch (error) {
          toast(error.message, true);
          revoke.disabled = false;
        }
      });
      actions.append(revoke);
    }
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
  renderIntegrationPermissions();
}

function renderIntegrationPermissions() {
  const target = $("#integration-permission-summary");
  if (!target) return;
  target.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = "Permission & access policies";
  target.append(heading);
  for (const permission of state.integrationPermissions) {
    const card = document.createElement("article");
    card.className = "list-item integration-permission";
    const title = document.createElement("strong");
    title.textContent = permission.provider.replaceAll("_", " ");
    const status = document.createElement("span");
    status.className = "integration-status " + (permission.status === "connected" || permission.status === "configured" ? "connected" : "not-configured");
    status.textContent = permission.status.replaceAll("_", " ");
    const model = document.createElement("div");
    model.className = "list-item-meta";
    model.textContent = permission.authModel;
    const boundary = document.createElement("p");
    boundary.textContent = permission.accessBoundary;
    card.append(title, status, model, boundary);
    const scopes = permission.grantedScopes?.length ? permission.grantedScopes : permission.requestedScopes || [];
    for (const scope of scopes) {
      const scopeLine = document.createElement("p");
      scopeLine.className = "list-item-meta";
      scopeLine.textContent = (permission.grantedScopes?.includes(scope) ? "Granted: " : "Required: ") + scope;
      card.append(scopeLine);
    }
    target.append(card);
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
        const externalRows = Array.isArray(step.result?.repositories)
          ? step.result.repositories.map((entry) => ({
              label: entry.fullName || entry.name,
              meta: (entry.private ? "Private" : "Public") + (entry.updatedAt ? " · Updated " + entry.updatedAt.slice(0, 10) : ""),
              url: entry.url
            }))
          : Array.isArray(step.result?.files)
            ? step.result.files.map((entry) => ({
                label: entry.name,
                meta: entry.mimeType + (entry.modifiedAt ? " · Modified " + entry.modifiedAt.slice(0, 10) : ""),
                url: entry.url
              }))
            : [];
        if (externalRows.length) {
          const resultList = document.createElement("ul");
          for (const entry of externalRows.slice(0, 8)) {
            const resultItem = document.createElement("li");
            if (entry.url) {
              const link = document.createElement("a");
              link.href = entry.url;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              link.textContent = entry.label;
              resultItem.append(link);
            } else {
              resultItem.textContent = entry.label;
            }
            const metadata = document.createElement("span");
            metadata.className = "list-item-meta";
            metadata.textContent = " · " + entry.meta;
            resultItem.append(metadata);
            resultList.append(resultItem);
          }
          item.append(resultList);
        }
        if (step.result?.profile) {
          const profile = document.createElement("p");
          profile.textContent = "Bot: @" + (step.result.profile.username || "unknown") +
            " · First name: " + (step.result.profile.firstName || "not provided");
          item.append(profile);
        }
        if (step.result?.account) {
          const account = document.createElement("p");
          account.textContent = "Account: " + (step.result.account.firstName || "Connected") +
            " · Plan: " + step.result.account.tier;
          item.append(account);
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
  stopHandsFreeMode();
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
  state.externalActions = [];
  state.actionCapabilities = null;
  state.googleDriveOAuth = null;
  state.integrationPermissions = [];
  state.editingWorkflowId = null;
  state.tasks = [];
  renderStorageOverview();
  showLogin();
  toast("Signed out.");
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll("[data-view-shortcut]").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.viewShortcut));
});

document.querySelectorAll(".prompt-card").forEach((button) => {
  button.addEventListener("click", () => {
    $("#chat-input").value = button.dataset.prompt || "";
    setView("chat");
    $("#chat-input").focus();
  });
});

let voiceModeActive = false;
let awaitingAssistantReply = false;
let voiceRestartTimer = null;
const orbitalVisual = createOrbitalVisual($("#orbital-canvas"));

function setOrbitalStatus(mode, message) {
  const status = $("#orbital-status");
  const headerState = $("#orbital-header-state");
  const dot = $("#orbital-state-dot");
  if (status) status.textContent = message;
  if (headerState) {
    const labels = { idle: "READY", listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING" };
    const label = labels[mode] || "READY";
    headerState.innerHTML = "<i></i> " + label;
  }
  if (dot) dot.dataset.state = mode;
  orbitalVisual?.setMode(mode);
}

function scheduleVoiceRestart(delay = 700) {
  clearTimeout(voiceRestartTimer);
  voiceRestartTimer = setTimeout(() => {
    if (!voiceModeActive || awaitingAssistantReply) return;
    if (voiceController.getState() === "idle") {
      setOrbitalStatus("listening", "Listening… speak naturally");
      voiceController.startListening();
    }
  }, delay);
}

function stopHandsFreeMode() {
  voiceModeActive = false;
  awaitingAssistantReply = false;
  clearTimeout(voiceRestartTimer);
  voiceController.stop();
  setOrbitalStatus("idle", "Tap the orb to speak");
  $("#voice-button")?.setAttribute("aria-pressed", "false");
  $("#voice-button")?.setAttribute("aria-label", "Start voice conversation");
  const footer = $(".orbital-footer span:first-child");
  if (footer) footer.textContent = "MICROPHONE OFF";
}

function renderVoiceOptions(voices = voiceController.getVoiceOptions($("#voice-language")?.value || "hi-IN")) {
  const select = $("#voice-output-voice");
  if (!select) return;
  const selectedURI = voiceController.getSelectedVoiceURI();
  select.replaceChildren();
  const automatic = document.createElement("option");
  automatic.value = "auto";
  automatic.textContent = "Automatic · match reply language";
  select.append(automatic);
  for (const voice of voices) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = voice.name + " (" + voice.lang + ")" +
      (voice.localService ? " · device" : "");
    select.append(option);
  }
  select.value = selectedURI && voices.some(voice => voice.voiceURI === selectedURI)
    ? selectedURI : "auto";
}

const voiceController = createVoiceController({
  SpeechRecognitionCtor: window.SpeechRecognition || window.webkitSpeechRecognition,
  speechSynthesis: window.speechSynthesis,
  createUtterance: (text) => new SpeechSynthesisUtterance(text),
  maxChunkChars: 220,
  onVoicesChanged: (voices) => renderVoiceOptions(voices),
  onStateChange: (voiceState) => {
    const status = $("#voice-status");
    const button = $("#voice-button");
    if (status) status.textContent = voiceState === "listening"
      ? "Listening…"
      : voiceState === "speaking" ? "Speaking…" : "Voice ready";
    const stopSpeechButton = $("#stop-speech-button");
    if (stopSpeechButton) stopSpeechButton.disabled = voiceState !== "speaking";
    if (button) {
      button.dataset.state = voiceState;
      button.setAttribute("aria-pressed", String(voiceModeActive));
      button.setAttribute("aria-label", voiceModeActive ? "Stop voice conversation" : "Start voice conversation");
    }
    if (voiceState === "listening") {
      setOrbitalStatus("listening", "Listening…");
      const footer = $(".orbital-footer span:first-child");
      if (footer) footer.textContent = "MICROPHONE ACTIVE";
    } else if (voiceState === "speaking") {
      setOrbitalStatus("speaking", "JARVIS is speaking");
      const footer = $(".orbital-footer span:first-child");
      if (footer) footer.textContent = "JARVIS SPEAKING";
    } else if (voiceState === "idle") {
      const footer = $(".orbital-footer span:first-child");
      if (footer && !voiceModeActive) footer.textContent = "MICROPHONE OFF";
      if (awaitingAssistantReply) setOrbitalStatus("thinking", "Thinking…");
      else if (voiceModeActive) scheduleVoiceRestart(650);
      else setOrbitalStatus("idle", "Tap the orb to speak");
    }
  },
  onTranscript: (transcript) => {
    const input = $("#chat-input");
    if (!input) return;
    awaitingAssistantReply = true;
    voiceController.stopListening();
    input.value = [input.value.trim(), transcript].filter(Boolean).join(" ");
    setOrbitalStatus("thinking", "Thinking…");
    $("#chat-form")?.requestSubmit();
  },
  onError: (code) => {
    const messages = {
      unsupported: "Voice recognition is not supported in this browser. You can still type below.",
      "not-allowed": "Microphone permission was denied. Allow microphone access in browser settings.",
      "service-not-allowed": "This browser blocked microphone access.",
      "no-speech": "I didn't catch that. Listening again…",
      network: "The browser speech service needs an internet connection.",
      "recognition-start-failed": "Could not start voice input. Check microphone permission.",
      "speech-unavailable": "Spoken replies are not supported in this browser.",
      "speech-failed": "JARVIS could not start spoken playback."
    };
    if (code === "no-speech" && voiceModeActive) {
      setOrbitalStatus("listening", "Didn't catch that. Try again…");
      return;
    }
    if (voiceModeActive && ["not-allowed", "service-not-allowed", "unsupported", "network"].includes(code)) {
      voiceModeActive = false;
      awaitingAssistantReply = false;
      clearTimeout(voiceRestartTimer);
    }
    setOrbitalStatus("idle", messages[code] || "Voice interaction stopped");
    toast(messages[code] || "Voice interaction failed.", true);
  }
});

voiceController.refreshVoices();
renderVoiceOptions();

$("#voice-output-voice").addEventListener("change", (event) => {
  const ok = voiceController.setVoiceURI(event.currentTarget.value);
  if (!ok) {
    event.currentTarget.value = "auto";
    toast("That voice is no longer available. Automatic voice matching is active.", true);
  }
});

$("#voice-output-rate").addEventListener("change", (event) => {
  voiceController.setSpeechRate(Number(event.currentTarget.value));
});

$("#menu-toggle").addEventListener("click", () => {
  const open = $("#app-shell").classList.toggle("menu-open");
  $("#menu-toggle").setAttribute("aria-expanded", String(open));
  $("#menu-toggle").setAttribute("aria-label", open ? "Close JARVIS menu" : "Open JARVIS menu");
});
$("#menu-backdrop").addEventListener("click", () => {
  $("#app-shell").classList.remove("menu-open");
  $("#menu-toggle").setAttribute("aria-expanded", "false");
});
$("#voice-button").addEventListener("click", () => {
  if (voiceModeActive) {
    stopHandsFreeMode();
    return;
  }
  voiceModeActive = true;
  awaitingAssistantReply = false;
  $("#voice-button").setAttribute("aria-pressed", "true");
  setOrbitalStatus("listening", "Starting microphone…");
  if (!voiceController.startListening()) {
    voiceModeActive = false;
    setOrbitalStatus("idle", "Tap the orb to speak");
    $("#voice-button").setAttribute("aria-pressed", "false");
    return;
  }
  toast("Voice conversation started. Tap the orb again to stop.");
});

window.addEventListener("pagehide", () => {
  voiceModeActive = false;
  clearTimeout(voiceRestartTimer);
  voiceController.destroy();
  orbitalVisual?.destroy();
});

$("#stop-speech-button").addEventListener("click", () => {
  voiceController.stopSpeaking();
});

$("#voice-language").addEventListener("change", (event) => {
  voiceController.setLanguage(event.target.value);
  const options = voiceController.getVoiceOptions(event.target.value);
  if (voiceController.getSelectedVoiceURI() &&
      !options.some(voice => voice.voiceURI === voiceController.getSelectedVoiceURI())) {
    voiceController.setVoiceURI("auto");
  }
  renderVoiceOptions(options);
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
  if (voiceModeActive) awaitingAssistantReply = true;
  voiceController.stopListening();
  voiceController.stopSpeaking();
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
    if ($("#speak-toggle").checked || voiceModeActive) {
      const replyLanguage = /[\u0900-\u097F]/.test(data.answer)
        ? "hi-IN"
        : ($("#voice-language").value || "hi-IN");
      awaitingAssistantReply = false;
      voiceController.speak(data.answer, replyLanguage);
    }
    await refreshState();
  } catch (error) {
    awaitingAssistantReply = false;
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
    setOrbitalStatus("idle", "I couldn't complete that request. Try again.");
    if (voiceModeActive) scheduleVoiceRestart(900);
  } finally {
    button.disabled = false;
    if (!voiceModeActive) input.blur();
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

$("#memory-preview-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("#memory-preview-status").textContent = "Checking saved memory relevance…";
  try {
    const preview = await api("/api/memories/preview", {
      method: "POST",
      body: JSON.stringify({ query: $("#memory-preview-query").value })
    });
    renderMemoryContextPreview(preview);
  } catch (error) {
    $("#memory-preview-status").textContent = error.message;
    $("#memory-preview-results").replaceChildren();
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
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

function renderSourceBasedAnswer(target, data) {
  target.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "source-answer-result";
  const heading = document.createElement("strong");
  heading.textContent = "Source-based answer";
  const status = document.createElement("div");
  status.className = "research-meta";
  status.textContent = data.answerStatus === "source-supported"
    ? "Source-supported answer · " + data.sourceCount + " pages read"
    : data.answerStatus === "insufficient-evidence"
      ? "Insufficient source evidence · do not treat this as a confirmed answer"
      : "Pages extracted · AI synthesis unavailable";
  const answer = document.createElement("p");
  answer.className = "research-answer";
  answer.textContent = data.answer || "No source-based answer was returned.";
  panel.append(heading, status, answer);

  const sourceByNumber = new Map((Array.isArray(data.sources) ? data.sources : [])
    .map(source => [Number(source.number), source]));

  const appendEvidenceSection = (title, items) => {
    if (!Array.isArray(items) || !items.length) return;
    const section = document.createElement("section");
    section.className = "source-answer-section";
    const sectionHeading = document.createElement("strong");
    sectionHeading.textContent = title;
    section.append(sectionHeading);
    const list = document.createElement("div");
    list.className = "source-answer-items";
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "source-answer-item";
      const claim = document.createElement("p");
      claim.textContent = item.claim || "";
      row.append(claim);
      const references = document.createElement("div");
      references.className = "source-answer-references";
      for (const number of Array.isArray(item.sourceNumbers) ? item.sourceNumbers : []) {
        const source = sourceByNumber.get(Number(number));
        const url = safeResearchUrl(source?.url);
        if (!source || !url) continue;
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "[" + number + "] " + (source.title || source.domain || "Source");
        references.append(link);
      }
      if (references.childNodes.length) row.append(references);
      list.append(row);
    }
    section.append(list);
    panel.append(section);
  };

  appendEvidenceSection("Key findings", data.findings);
  appendEvidenceSection("Where sources agree", data.agreements);
  appendEvidenceSection("Differences between sources", data.differences);
  appendEvidenceSection("Uncertainty and missing evidence", data.uncertainties);

  if (data.insufficientEvidence && (!Array.isArray(data.uncertainties) || !data.uncertainties.length)) {
    const note = document.createElement("p");
    note.className = "research-citations";
    note.textContent = "The selected pages do not establish a reliable answer. Check the original sources or search for stronger evidence.";
    panel.append(note);
  }

  const sourceHeading = document.createElement("strong");
  sourceHeading.textContent = "Pages read";
  const sourceList = document.createElement("div");
  sourceList.className = "source-answer-items";
  for (const source of Array.isArray(data.sources) ? data.sources : []) {
    const row = document.createElement("article");
    row.className = "source-answer-item";
    const url = safeResearchUrl(source.url);
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "[" + source.number + "] " + (source.title || source.domain || "Source");
      row.append(link);
    } else {
      const unavailable = document.createElement("span");
      unavailable.textContent = "[" + source.number + "] " + (source.title || "Source") + " — unavailable";
      row.append(unavailable);
    }
    const meta = document.createElement("div");
    meta.className = "research-meta";
    meta.textContent = source.status === "read"
      ? "Read " + (source.retrievedAt ? new Date(source.retrievedAt).toLocaleString() : "")
      : (source.reason || "Could not read this page.");
    row.append(meta);
    if (source.excerpt) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "View extracted excerpt";
      const excerpt = document.createElement("p");
      excerpt.textContent = source.excerpt;
      details.append(summary, excerpt);
      row.append(details);
    }
    sourceList.append(row);
  }
  panel.append(sourceHeading, sourceList);
  if (data.answerStatus === "source-supported" &&
      data.aiSynthesized === true &&
      Array.isArray(data.findings) && data.findings.length > 0) {
    const saveAnswer = document.createElement("button");
    saveAnswer.type = "button";
    saveAnswer.className = "item-action";
    saveAnswer.textContent = "Save answer to Knowledge · needs review";
    saveAnswer.addEventListener("click", async () => {
      saveAnswer.disabled = true;
      try {
        const sections = [
          data.answer || "",
          Array.isArray(data.agreements) && data.agreements.length
            ? "Where sources agree:\n" + data.agreements.map(item => "• " + item.claim).join("\n") : "",
          Array.isArray(data.differences) && data.differences.length
            ? "Differences between sources:\n" + data.differences.map(item => "• " + item.claim).join("\n") : "",
          Array.isArray(data.uncertainties) && data.uncertainties.length
            ? "Uncertainty and missing evidence:\n" + data.uncertainties.map(item => "• " + item.claim).join("\n") : ""
        ].filter(Boolean);
        const readableSources = (Array.isArray(data.sources) ? data.sources : [])
          .filter(source => source.status === "read" && safeResearchUrl(source.url))
          .map(source => ({
            title: source.title || source.domain || "Research source",
            url: source.url,
            snippet: source.excerpt || "",
            retrievedAt: source.retrievedAt || null
          }));
        const payload = await api("/api/knowledge", {
          method: "POST",
          body: JSON.stringify({
            title: (data.query || "Source-based research").slice(0, 180),
            content: sections.join("\n\n").slice(0, 8000),
            category: "general",
            tags: ["research", "source-based"],
            sourceKind: "web-research",
            sourceQuery: data.query || "",
            capturedAt: data.generatedAt || new Date().toISOString(),
            sources: readableSources,
            citations: Array.isArray(data.citations) ? data.citations : []
          })
        });
        await refreshKnowledge(state.knowledgeQuery, state.knowledgeFilter);
        saveAnswer.textContent = payload.duplicate
          ? "Saved source history updated"
          : "Saved · awaiting your review";
        toast(payload.duplicate
          ? "Existing knowledge updated with the new source history; its review decision was preserved."
          : "Saved to Knowledge. Review the original sources before approving it for assistant context.");
      } catch (error) {
        saveAnswer.disabled = false;
        toast(error.message, true);
      }
    });
    panel.append(saveAnswer);
  }

  const note = document.createElement("p");
  note.className = "research-citations";
  note.textContent = "Citations link to the exact selected pages. Evidence strength is an AI assessment, not an independent fact-check.";
  panel.append(note);
  target.append(panel);
}

function renderGroundedResearch(item, canSave = true) {
  const selectableReadSources = [];
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
      if (source.readToken && selectableReadSources.length < 5) {
        const choice = document.createElement("label");
        choice.className = "source-answer-choice";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.setAttribute("aria-label", "Use " + (source.title || source.domain || "source") + " in the answer");
        choice.append(checkbox, document.createTextNode("Use in answer"));
        row.append(choice);
        selectableReadSources.push({ checkbox, readToken: source.readToken });
      }
      if (source.readToken) {
        const readButton = document.createElement("button");
        readButton.type = "button";
        readButton.className = "item-action";
        readButton.textContent = "Read full page";
        const pagePanel = document.createElement("section");
        pagePanel.className = "research-page-panel";
        pagePanel.hidden = true;
        readButton.addEventListener("click", async () => {
          if (!pagePanel.hidden) {
            pagePanel.hidden = true;
            readButton.textContent = "Read full page";
            return;
          }
          readButton.disabled = true;
          readButton.textContent = "Reading…";
          pagePanel.hidden = false;
          pagePanel.replaceChildren(makeEmpty("Fetching and safely extracting this source webpage…"));
          try {
            const pageData = await api("/api/research/read", {
              method: "POST",
              body: JSON.stringify({ readToken: source.readToken, question: item.query || "" })
            });
            pagePanel.replaceChildren();
            const pageTitle = document.createElement("strong");
            pageTitle.textContent = pageData.page.title || source.title || "Source webpage";
            const pageMeta = document.createElement("div");
            pageMeta.className = "research-meta";
            pageMeta.textContent = "Retrieved " + new Date(pageData.page.retrievedAt).toLocaleString() +
              " · " + (pageData.aiSynthesized ? "AI summary from full page" : "full-page text extraction") +
              (pageData.page.truncated ? " · text shortened to fit the safe limit" : "");
            const pageAnswer = document.createElement("p");
            pageAnswer.className = "research-answer";
            pageAnswer.textContent = pageData.answer || "No summary was returned.";
            const textHeading = document.createElement("div");
            textHeading.className = "research-citations";
            textHeading.textContent = "Extracted source text";
            const extracted = document.createElement("div");
            extracted.className = "research-page-text";
            extracted.textContent = pageData.page.text || "";
            const savePage = document.createElement("button");
            savePage.type = "button";
            savePage.className = "item-action";
            savePage.textContent = "Save page to Knowledge";
            savePage.addEventListener("click", async () => {
              savePage.disabled = true;
              try {
                const content = (pageData.aiSynthesized ? pageData.answer : pageData.page.text).slice(0, 8000);
                await api("/api/knowledge", {
                  method: "POST",
                  body: JSON.stringify({
                    title: pageData.page.title || source.title || "Saved webpage",
                    content,
                    category: "general",
                    sourceKind: "web-research",
                    sourceQuery: item.query || "",
                    sources: [{
                      title: pageData.page.title || source.title || "Source webpage",
                      url: pageData.page.url,
                      snippet: pageData.page.description || pageData.page.text.slice(0, 500)
                    }],
                    citations: pageData.citations || []
                  })
                });
                await refreshKnowledge(state.knowledgeQuery);
                savePage.textContent = "Saved to Knowledge";
                toast("The page summary was saved to your Knowledge Library.");
              } catch (error) {
                savePage.disabled = false;
                toast(error.message, true);
              }
            });
            pagePanel.append(pageTitle, pageMeta, pageAnswer, textHeading, extracted, savePage);
            readButton.textContent = "Hide page";
          } catch (error) {
            pagePanel.replaceChildren(makeEmpty(error.message));
            readButton.textContent = "Retry page read";
          } finally {
            readButton.disabled = false;
          }
        });
        row.append(readButton, pagePanel);
      }
      sourceList.append(row);
    }
    card.append(sourceHeading, sourceList);

    if (selectableReadSources.length >= 2) {
      const answerControls = document.createElement("div");
      answerControls.className = "source-answer-controls";
      const answerNote = document.createElement("p");
      answerNote.className = "research-meta";
      answerNote.textContent = "Choose 2–5 pages. JARVIS reads the selected pages and keeps factual claims linked to their sources.";
      const answerButton = document.createElement("button");
      answerButton.type = "button";
      answerButton.className = "primary";
      answerButton.textContent = "Build source-based answer";
      const answerPanel = document.createElement("div");
      answerPanel.className = "source-answer-output";
      answerButton.addEventListener("click", async () => {
        const readTokens = selectableReadSources
          .filter(source => source.checkbox.checked)
          .map(source => source.readToken);
        if (readTokens.length < 2 || readTokens.length > 5) {
          toast("Choose between two and five source pages.", true);
          return;
        }
        answerButton.disabled = true;
        answerButton.textContent = "Reading sources…";
        answerPanel.replaceChildren(makeEmpty("Reading selected sources and checking their evidence…"));
        try {
          const data = await api("/api/research/answer", {
            method: "POST",
            body: JSON.stringify({ question: item.query || "", readTokens })
          });
          renderSourceBasedAnswer(answerPanel, data);
        } catch (error) {
          answerPanel.replaceChildren(makeEmpty(error.message));
          toast(error.message, true);
        } finally {
          answerButton.disabled = false;
          answerButton.textContent = "Build source-based answer";
        }
      });
      answerControls.append(answerNote, answerButton, answerPanel);
      card.append(answerControls);
    }
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

async function updateKnowledgeReview(item, reviewStatus) {
  let reviewNote = "";
  if (reviewStatus === "rejected") {
    const response = window.prompt("Why are you rejecting this saved research? (Optional, 500 characters max)", item.reviewNote || "");
    if (response === null) return;
    reviewNote = response.slice(0, 500);
  }

  try {
    await api("/api/knowledge/" + encodeURIComponent(item.id), {
      method: "PATCH",
      body: JSON.stringify({ reviewStatus, reviewNote })
    });
    await refreshKnowledge(state.knowledgeQuery, state.knowledgeFilter);
    const message = reviewStatus === "user-reviewed"
      ? "Research approved for assistant context. This records your review, not an independent fact-check."
      : reviewStatus === "rejected"
        ? "Research rejected and excluded from assistant context."
        : "Research returned to the review queue and excluded from assistant context.";
    toast(message);
  } catch (error) {
    toast(error.message, true);
  }
}

function renderKnowledge() {
  const target = $("#knowledge-list");
  if (!target) return;
  target.replaceChildren();
  const count = $("#knowledge-count");
  if (count) count.textContent = state.knowledgeTotal + " saved";

  const summary = $("#knowledge-review-summary");
  if (summary) {
    const counts = state.knowledgeSummary || { trusted: 0, unreviewed: 0, rejected: 0 };
    summary.textContent = counts.trusted + " trusted for assistant context · " +
      counts.unreviewed + " awaiting your review · " +
      counts.rejected + " rejected and excluded. Your notes are user-authored.";
  }

  if (!state.knowledge.length) {
    const emptyMessage = state.knowledgeQuery
      ? "No knowledge entries matched this search and review filter."
      : state.knowledgeFilter === "unreviewed"
        ? "No saved research is waiting for review."
        : state.knowledgeFilter === "rejected"
          ? "No knowledge entries have been rejected."
          : state.knowledgeFilter === "trusted"
            ? "No reviewed research or user-authored notes are in this view yet."
            : "No saved knowledge yet. Add a note or use “Save to Knowledge” on a research result.";
    target.append(makeEmpty(emptyMessage));
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
      ? "Reviewed by you"
      : item.reviewStatus === "unreviewed" ? "Needs review"
        : item.reviewStatus === "rejected" ? "Rejected by you" : "User-authored";
    meta.textContent = [
      item.category || "general",
      sourceLabel,
      reviewLabel,
      item.capturedAt ? "Captured " + new Date(item.capturedAt).toLocaleString() : "",
      item.updatedAt && item.updatedAt !== item.createdAt ? "Updated " + new Date(item.updatedAt).toLocaleString() : ""
    ].filter(Boolean).join(" · ");
    main.append(title, description, meta);

    if (Array.isArray(item.tags) && item.tags.length) {
      const tags = document.createElement("div");
      tags.className = "list-item-meta";
      tags.textContent = "Tags: " + item.tags.join(", ");
      main.append(tags);
    }

    if (item.reviewStatus === "rejected" && item.reviewNote) {
      const reason = document.createElement("div");
      reason.className = "list-item-meta";
      reason.textContent = "Review note: " + item.reviewNote;
      main.append(reason);
    }

    if (Array.isArray(item.sources) && item.sources.length) {
      const sourceList = document.createElement("div");
      sourceList.className = "research-sources";
      for (const source of item.sources.slice(0, 6)) {
        const sourceRow = document.createElement("div");
        sourceRow.className = "knowledge-source";
        const url = safeResearchUrl(source.url);
        if (url) {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
          anchor.textContent = source.title || source.domain || new URL(url).hostname;
          sourceRow.append(anchor);
        }
        const dates = [
          source.publishedAt ? "Published: " + source.publishedAt : "",
          source.retrievedAt ? "Retrieved: " + new Date(source.retrievedAt).toLocaleString() : ""
        ].filter(Boolean);
        if (dates.length) {
          const dateLabel = document.createElement("span");
          dateLabel.textContent = dates.join(" · ");
          sourceRow.append(dateLabel);
        }
        sourceList.append(sourceRow);
      }
      main.append(sourceList);
    }

    const actions = document.createElement("div");
    actions.className = "device-actions";
    if (item.sourceKind === "web-research" && item.reviewStatus === "unreviewed") {
      const review = document.createElement("button");
      review.type = "button";
      review.className = "item-action";
      review.textContent = "Mark reviewed";
      review.addEventListener("click", () => updateKnowledgeReview(item, "user-reviewed"));
      const reject = document.createElement("button");
      reject.type = "button";
      reject.className = "item-action";
      reject.textContent = "Reject";
      reject.addEventListener("click", () => updateKnowledgeReview(item, "rejected"));
      actions.append(review, reject);
    } else if (item.sourceKind === "web-research") {
      const reopen = document.createElement("button");
      reopen.type = "button";
      reopen.className = "item-action";
      reopen.textContent = item.reviewStatus === "rejected" ? "Reopen review" : "Reset review";
      reopen.addEventListener("click", () => updateKnowledgeReview(item, "unreviewed"));
      actions.append(reopen);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "item-action";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await api("/api/knowledge/" + encodeURIComponent(item.id), { method: "DELETE" });
        await refreshKnowledge(state.knowledgeQuery, state.knowledgeFilter);
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

async function refreshKnowledge(query = state.knowledgeQuery, reviewFilter = state.knowledgeFilter) {
  state.knowledgeQuery = String(query || "").trim();
  state.knowledgeFilter = ["all", "trusted", "unreviewed", "rejected"].includes(reviewFilter) ? reviewFilter : "all";
  const params = new URLSearchParams();
  if (state.knowledgeQuery) params.set("q", state.knowledgeQuery);
  if (state.knowledgeFilter !== "all") params.set("review", state.knowledgeFilter);
  const queryString = params.toString();
  const suffix = queryString ? "?" + queryString : "";
  const data = await api("/api/knowledge" + suffix);
  state.knowledge = Array.isArray(data.items) ? data.items : [];
  state.knowledgeTotal = Number(data.total) || 0;
  state.knowledgeSummary = data.reviewSummary || { total: state.knowledgeTotal, trusted: 0, unreviewed: 0, rejected: 0 };
  const filter = $("#knowledge-review-filter");
  if (filter && filter.value !== state.knowledgeFilter) filter.value = state.knowledgeFilter;
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
    await refreshKnowledge($("#knowledge-search-input").value, state.knowledgeFilter);
    if (state.knowledgeQuery && !state.knowledge.length) toast("No saved knowledge matched that search.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#knowledge-review-filter").addEventListener("change", async (event) => {
  try {
    await refreshKnowledge(state.knowledgeQuery, event.currentTarget.value);
  } catch (error) {
    toast(error.message, true);
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




function renderSystemDiagnostics() {
  const summary = $("#diagnostic-summary");
  const target = $("#diagnostic-check-list");
  const timestamp = $("#diagnostic-generated-at");
  if (!summary || !target) return;
  summary.replaceChildren();
  target.replaceChildren();

  const data = state.diagnostics;
  if (!data) {
    summary.append(makeEmpty("Run a system check to view the current JARVIS readiness report."));
    return;
  }

  const heading = document.createElement("div");
  heading.className = "diagnostic-overview";
  const title = document.createElement("strong");
  title.textContent = data.status === "ready"
    ? "All configured core checks are ready"
    : data.status === "degraded"
      ? "Storage needs attention"
      : "JARVIS is running with some optional services unavailable";
  const description = document.createElement("p");
  description.textContent = data.summary || "Readiness check completed.";
  const status = document.createElement("span");
  status.className = "diagnostic-status diagnostic-status-" + String(data.status || "attention");
  status.textContent = String(data.status || "attention").replaceAll("_", " ");
  heading.append(title, description, status);
  summary.append(heading);

  if (!Array.isArray(data.checks) || !data.checks.length) {
    target.append(makeEmpty("No system checks were returned."));
  } else {
    for (const check of data.checks) {
      const card = document.createElement("article");
      card.className = "diagnostic-card";
      const cardHeader = document.createElement("div");
      cardHeader.className = "diagnostic-card-header";
      const name = document.createElement("strong");
      name.textContent = check.label || check.id || "System check";
      const badge = document.createElement("span");
      badge.className = "diagnostic-status diagnostic-status-" + String(check.status || "warning");
      badge.textContent = String(check.status || "warning");
      cardHeader.append(name, badge);

      const copy = document.createElement("p");
      copy.textContent = check.summary || "";
      card.append(cardHeader, copy);

      if (check.details && typeof check.details === "object") {
        const details = document.createElement("div");
        details.className = "diagnostic-details";
        for (const [key, value] of Object.entries(check.details)) {
          if (value === null || value === undefined || key === "providers") continue;
          const item = document.createElement("span");
          item.textContent = key.replace(/([A-Z])/g, " $1").replaceAll("_", " ") + ": " +
            (Array.isArray(value) ? value.join(", ") : String(value));
          details.append(item);
        }
        if (Array.isArray(check.details.providers)) {
          for (const provider of check.details.providers) {
            const item = document.createElement("span");
            item.textContent = provider.name + ": " +
              (provider.enabled ? "enabled" : provider.configured ? "configured, disabled" : "not configured");
            details.append(item);
          }
        }
        if (details.childElementCount) card.append(details);
      }
      target.append(card);
    }
  }

  if (timestamp) {
    timestamp.textContent = data.generatedAt
      ? "Checked " + new Date(data.generatedAt).toLocaleString() + " · " + data.warningCount + " warning(s)"
      : "";
  }
}

async function refreshSystemDiagnostics() {
  const button = $("#refresh-diagnostics");
  const target = $("#diagnostic-check-list");
  if (button) button.disabled = true;
  if (target) {
    target.replaceChildren();
    target.append(makeEmpty("Checking JARVIS storage and configured capabilities…"));
  }
  try {
    state.diagnostics = await api("/api/diagnostics");
    renderSystemDiagnostics();
  } finally {
    if (button) button.disabled = false;
  }
}

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
$("#refresh-diagnostics").addEventListener("click", () => refreshSystemDiagnostics().catch((error) => toast(error.message, true)));

$("#external-action-type").addEventListener("change", updateExternalActionFields);
$("#action-google-permission").addEventListener("click", startGoogleDocsPermissionUpgrade);
$("#external-action-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const type = $("#external-action-type").value;
  const submit = $("#external-action-submit");
  const payload = type === "telegram_send_message"
    ? { type, chatId: $("#action-telegram-chat").value, text: $("#action-telegram-text").value }
    : { type, title: $("#action-google-title").value, content: $("#action-google-content").value };
  submit.disabled = true;
  try {
    const data = await api("/api/actions", { method: "POST", body: JSON.stringify(payload) });
    state.externalActions = [data.action, ...state.externalActions].slice(0, 100);
    renderExternalActions();
    toast("Preview saved. Nothing has been sent or created yet.");
  } catch (error) {
    toast(error.message, true);
  } finally {
    updateExternalActionFields();
  }
});

boot();
