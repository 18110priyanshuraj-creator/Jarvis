export function createScheduleWorkspace({ api, toast }) {
  const $ = (selector) => document.querySelector(selector);
  let schedules = [];
  let events = [];
  let workflows = [];
  let pending = {};
  let serverStatus = null;
  let knownEvents = null;
  let loading = false;

  function node(tag, className, content) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (content !== undefined) item.textContent = content;
    return item;
  }

  function localDate(value) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Unknown time";
  }

  function renderSummary() {
    const target = $("#schedule-summary");
    if (!target) return;
    target.textContent =
      (pending.pending || 0) + " pending tasks · " +
      (pending.overdue || 0) + " overdue · " +
      (pending.highPriority || 0) + " high priority · " +
      schedules.filter((item) => item.status === "active").length + " active schedules";
  }

  function renderWorkflowOptions() {
    const select = $("#schedule-workflow-id");
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option("Choose an approved workflow", ""));
    for (const workflow of workflows.filter((item) => item.status === "approved" && item.approvedAt)) {
      select.add(new Option(workflow.name, workflow.id));
    }
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }

  function toggleKindFields() {
    const kind = $("#schedule-kind")?.value || "reminder";
    $("#schedule-query-field")?.classList.toggle("hidden", kind !== "research");
    $("#schedule-workflow-field")?.classList.toggle("hidden", kind !== "workflow");
    $("#schedule-description-field")?.classList.toggle("hidden", kind === "research");
    $("#schedule-recurrence").disabled = kind === "daily_summary";
    if (kind === "daily_summary") $("#schedule-recurrence").value = "daily";
    if (kind !== "daily_summary" && $("#schedule-recurrence").disabled) $("#schedule-recurrence").disabled = false;
  }

  function renderSchedules() {
    const target = $("#schedule-list");
    if (!target) return;
    target.replaceChildren();
    if (!schedules.length) {
      target.append(node("p", "small muted", "No reminders or scheduled workflows yet."));
      return;
    }
    for (const item of schedules) {
      const row = node("article", "list-item schedule-item");
      const main = node("div", "list-item-main");
      const title = node("strong", "", item.title);
      const status = node("span", "workflow-status workflow-status-" + item.status, item.status);
      const kind = node("p", "list-item-meta", item.kind.replace(/_/g, " ") + " · " + item.recurrence + " · " + item.priority + " priority");
      const next = node("p", "", item.nextRunAt ? "Next: " + localDate(item.nextRunAt) : "No future run");
      const scope = item.kind === "research" ? node("p", "small muted", "Research: " + item.query) :
        item.kind === "workflow" ? node("p", "small muted", "Approved workflow: " + (workflows.find((w) => w.id === item.workflowId)?.name || "Workflow unavailable")) :
        item.description ? node("p", "small muted", item.description) : null;
      main.append(title, status, kind, next);
      if (scope) main.append(scope);
      if (item.missedCount) main.append(node("p", "small muted", item.missedCount + " missed occurrence(s) recorded."));
      const actions = node("div", "device-actions");
      if (item.status === "active") {
        const pause = node("button", "item-action", "Pause");
        pause.type = "button";
        pause.addEventListener("click", () => changeStatus(item, "paused"));
        actions.append(pause);
      } else if (item.status === "paused") {
        const resume = node("button", "item-action", "Resume");
        resume.type = "button";
        resume.addEventListener("click", () => changeStatus(item, "active"));
        actions.append(resume);
      }
      if (["active", "paused"].includes(item.status)) {
        const cancel = node("button", "item-action", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", () => cancelSchedule(item));
        actions.append(cancel);
      }
      row.append(main, actions);
      target.append(row);
    }
  }

  function notifyNewEvents() {
    if (!Array.isArray(events)) return;
    if (knownEvents === null) {
      knownEvents = new Set(events.map((item) => item.id));
      return;
    }
    for (const event of events) {
      if (knownEvents.has(event.id)) continue;
      knownEvents.add(event.id);
      if (!event.browserNotificationApproved || !["delivered", "triggered", "missed", "blocked"].includes(event.status)) continue;
      if (!("Notification" in window) || Notification.permission !== "granted") continue;
      const body = event.details?.message || event.details?.reason || ("Schedule status: " + event.status.replace(/_/g, " "));
      try { new Notification(event.title, { body, tag: event.id }); } catch { /* in-app event history remains available */ }
    }
  }

  function renderEvents() {
    const target = $("#schedule-event-list");
    if (!target) return;
    target.replaceChildren();
    if (!events.length) {
      target.append(node("p", "small muted", "No schedule notifications yet."));
      return;
    }
    for (const event of events) {
      const row = node("article", "list-item schedule-event");
      const main = node("div", "list-item-main");
      const title = node("strong", "", event.title);
      const state = node("span", "workflow-status workflow-status-" + event.status, event.status.replace(/_/g, " "));
      const meta = node("p", "list-item-meta", localDate(event.occurrenceAt) + " · " + event.kind.replace(/_/g, " "));
      const message = node("p", "small muted",
        event.details?.message || event.details?.recoveryNote || event.details?.reason || "No additional details.");
      main.append(title, state, meta, message);
      if (event.details?.sources?.length) {
        const sources = node("p", "small muted", event.details.sources.length + " source link(s) were captured. Open Research to inspect the current results.");
        main.append(sources);
      }
      if (event.workflowRunId) main.append(node("p", "small muted", "Workflow run ID: " + event.workflowRunId));
      const actions = node("div", "device-actions");
      if (!event.readAt) {
        const read = node("button", "item-action", "Mark read");
        read.type = "button";
        read.addEventListener("click", async () => {
          read.disabled = true;
          try { await api("/api/schedule-events/" + encodeURIComponent(event.id) + "/read", { method: "POST", body: JSON.stringify({}) }); await load(); }
          catch (error) { read.disabled = false; toast(error.message, true); }
        });
        actions.append(read);
      }
      row.append(main, actions);
      target.append(row);
    }
  }

  async function load() {
    const [data, status, workflowData] = await Promise.all([
      api("/api/schedules"),
      api("/api/scheduler/status"),
      api("/api/workflows")
    ]);
    schedules = Array.isArray(data.schedules) ? data.schedules : [];
    events = Array.isArray(data.events) ? data.events : [];
    pending = data.pendingTasks || {};
    workflows = Array.isArray(workflowData.workflows) ? workflowData.workflows : [];
    serverStatus = status;
    renderSummary();
    renderWorkflowOptions();
    renderSchedules();
    notifyNewEvents();
    renderEvents();
    const note = $("#scheduler-runtime-note");
    if (note) note.textContent = status.note || "Schedules run only while the JARVIS server is available.";
    const unread = $("#schedule-unread-count");
    if (unread) unread.textContent = String(Number(data.unreadEvents) || 0) + " unread";
    return data;
  }

  async function changeStatus(item, status) {
    try {
      await api("/api/schedules/" + encodeURIComponent(item.id), {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      await load();
      toast(status === "paused" ? "Schedule paused." : "Schedule resumed.");
    } catch (error) { toast(error.message, true); }
  }

  async function cancelSchedule(item) {
    if (!window.confirm("Cancel this schedule? Its history will be kept.")) return;
    try {
      await api("/api/schedules/" + encodeURIComponent(item.id), { method: "DELETE" });
      await load();
      toast("Schedule cancelled. Its history was preserved.");
    } catch (error) { toast(error.message, true); }
  }

  function init() {
    const form = $("#schedule-form");
    if (!form) return;
    $("#schedule-kind").addEventListener("change", toggleKindFields);
    toggleKindFields();

    $("#enable-browser-notifications")?.addEventListener("click", async () => {
      if (!("Notification" in window)) {
        toast("This browser or Android WebView does not support browser notifications.", true);
        return;
      }
      try {
        const permission = await Notification.requestPermission();
        toast(permission === "granted" ? "Browser notifications enabled. Individual schedules still require their own opt-in." : "Browser notifications were not enabled.");
      } catch { toast("Browser notification permission could not be requested.", true); }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("#schedule-submit");
      if (button) button.disabled = true;
      try {
        const localDue = $("#schedule-due-at").value;
        if (!localDue) throw new Error("Choose a date and time.");
        const dueAt = new Date(localDue);
        if (!Number.isFinite(dueAt.getTime())) throw new Error("The scheduled date and time is invalid.");
        const kind = $("#schedule-kind").value;
        const payload = {
          kind,
          title: $("#schedule-title").value.trim(),
          description: $("#schedule-description").value.trim(),
          query: $("#schedule-query").value.trim(),
          workflowId: $("#schedule-workflow-id").value,
          dueAt: dueAt.toISOString(),
          recurrence: kind === "daily_summary" ? "daily" : $("#schedule-recurrence").value,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
          priority: $("#schedule-priority").value,
          browserNotificationApproved: $("#schedule-browser-notification").checked
        };
        await api("/api/schedules", { method: "POST", body: JSON.stringify(payload) });
        form.reset();
        $("#schedule-recurrence").value = "once";
        $("#schedule-priority").value = "normal";
        toggleKindFields();
        await load();
        toast("Schedule saved. It will run while the JARVIS server is available.");
      } catch (error) { toast(error.message || "Schedule could not be saved.", true); }
      finally { if (button) button.disabled = false; }
    });

    load().catch((error) => toast(error.message, true));
    window.setInterval(() => {
      if (document.visibilityState === "visible" && !loading) {
        loading = true;
        load().catch(() => {}).finally(() => { loading = false; });
      }
    }, 30_000);
  }

  return { init, load };
}
