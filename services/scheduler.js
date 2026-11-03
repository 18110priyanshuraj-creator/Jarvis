import crypto from "node:crypto";

export const SCHEDULER_LIMITS = Object.freeze({ schedules: 100, events: 200, title: 120, description: 600, query: 400, lookAheadDays: 366, graceMinutes: 5, tickMs: 30_000 });
const KINDS = new Set(["reminder", "research", "daily_summary", "workflow"]);
const RECURRENCES = new Set(["once", "daily", "weekly"]);
const STATES = new Set(["active", "paused", "completed", "cancelled"]);
const EVENT_STATES = new Set(["running", "delivered", "triggered", "missed", "blocked", "failed", "needs_review"]);
const PRIORITIES = new Set(["low", "normal", "high"]);
const SECRET = /\b(?:api[_ -]?key|password|passcode|bearer\s+[a-z0-9._-]{8,}|secret\s*[:=]|private key|otp|one.?time password)\b/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

function text(value, max) { return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, max) : ""; }
function safe(value, label, max) {
  const result = text(value, max);
  if (SECRET.test(result) || EMAIL.test(result)) throw new TypeError(label + " contains a credential or private contact detail.");
  return result;
}
function iso(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(label + " must be a valid date and time.");
  return date.toISOString();
}
function timeZone(value) {
  const zone = text(value, 80) || "Asia/Kolkata";
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date()); return zone; }
  catch { throw new TypeError("Choose a valid IANA time zone."); }
}
function details(input = {}) {
  const output = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return output;
  for (const [key, value] of Object.entries(input).slice(0, 12)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,35}$/.test(key) || /secret|token|password|credential|cookie|authorization|api.?key/i.test(key)) continue;
    if (typeof value === "string") output[key] = safe(value, "Event detail", 600);
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "boolean" || value === null) output[key] = value;
    else if (Array.isArray(value)) output[key] = value.slice(0, 10).map((item) => typeof item === "string" ? safe(item, "Event detail", 240) : null).filter(Boolean);
  }
  return output;
}

export function normalizeSchedule(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Schedule record is invalid.");
  const id = text(input.id, 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TypeError("Schedule ID is invalid.");
  const kind = text(input.kind, 30);
  const recurrence = text(input.recurrence || "once", 20);
  const status = text(input.status || "active", 20);
  if (!KINDS.has(kind)) throw new TypeError("Choose reminder, research, daily summary or approved workflow.");
  if (!RECURRENCES.has(recurrence)) throw new TypeError("Choose once, daily or weekly recurrence.");
  if (!STATES.has(status)) throw new TypeError("Schedule state is invalid.");
  const title = safe(input.title, "Schedule title", SCHEDULER_LIMITS.title);
  if (title.length < 2) throw new TypeError("Schedule title must contain at least two characters.");
  const query = safe(input.query, "Research query", SCHEDULER_LIMITS.query);
  if (kind === "research" && query.length < 4) throw new TypeError("Scheduled research needs a clear public-web search query.");
  if (kind === "daily_summary" && recurrence !== "daily" && recurrence !== "once") throw new TypeError("Daily summaries can run once or recur daily.");
  const workflowId = text(input.workflowId, 80);
  if (kind === "workflow" && !/^[0-9a-f-]{36}$/i.test(workflowId)) throw new TypeError("Select an existing approved workflow.");
  const dueAt = iso(input.dueAt, "Scheduled time");
  const nextRunAt = input.nextRunAt ? iso(input.nextRunAt, "Next run time") : dueAt;
  const createdAt = input.createdAt ? iso(input.createdAt, "Created time") : new Date().toISOString();
  const updatedAt = input.updatedAt ? iso(input.updatedAt, "Updated time") : createdAt;
  return {
    id, kind, title, description: safe(input.description, "Schedule description", SCHEDULER_LIMITS.description),
    query, workflowId: kind === "workflow" ? workflowId : "", dueAt,
    nextRunAt: status === "completed" || status === "cancelled" ? null : nextRunAt,
    recurrence, timeZone: timeZone(input.timeZone), priority: PRIORITIES.has(input.priority) ? input.priority : "normal",
    browserNotificationApproved: input.browserNotificationApproved === true, status, createdAt, updatedAt,
    lastRunAt: input.lastRunAt ? iso(input.lastRunAt, "Last run time") : null,
    missedCount: Number.isInteger(input.missedCount) ? Math.max(0, Math.min(100_000, input.missedCount)) : 0,
    lastEventId: text(input.lastEventId, 80)
  };
}

export function createSchedule(input = {}, options = {}) {
  const now = iso(options.now || new Date().toISOString(), "Current time");
  const dueAt = iso(input.dueAt, "Scheduled time");
  const dueMs = Date.parse(dueAt);
  const nowMs = Date.parse(now);
  if (dueMs <= nowMs) throw new TypeError("Choose a future date and time for a new schedule.");
  if (dueMs > nowMs + SCHEDULER_LIMITS.lookAheadDays * 86_400_000) throw new TypeError("Schedules can be created up to one year ahead.");
  return normalizeSchedule({
    ...input, id: crypto.randomUUID(), dueAt, nextRunAt: dueAt, status: "active",
    createdAt: now, updatedAt: now, missedCount: 0, lastRunAt: null, lastEventId: ""
  });
}

export function setScheduleStatus(input, status, now = new Date().toISOString()) {
  const item = normalizeSchedule(input);
  if (!["active", "paused", "cancelled"].includes(status)) throw new TypeError("Choose active, paused or cancelled.");
  if (item.status === "completed") throw new TypeError("A completed one-time schedule cannot be restarted.");
  if (item.status === "cancelled" && status !== "cancelled") throw new TypeError("A cancelled schedule cannot be restarted. Create a new schedule instead.");
  return { ...item, status, updatedAt: iso(now, "Updated time"), nextRunAt: status === "cancelled" ? null : item.nextRunAt };
}

export function advanceSchedule(input, occurrenceAt, processedAt = occurrenceAt) {
  const item = normalizeSchedule(input);
  const occurrence = iso(occurrenceAt, "Occurrence time");
  const processed = iso(processedAt, "Processed time");
  const updated = { ...item, lastRunAt: occurrence, updatedAt: processed };
  if (item.recurrence === "once") return { ...updated, status: "completed", nextRunAt: null };
  const interval = item.recurrence === "daily" ? 86_400_000 : 604_800_000;
  let next = Date.parse(occurrence) + interval;
  let skipped = 0;
  while (next <= Date.parse(processed) && skipped < 1000) { next += interval; skipped += 1; }
  if (skipped >= 1000) throw new RangeError("The recurring schedule is too far behind to advance safely.");
  return { ...updated, nextRunAt: new Date(next).toISOString(), missedCount: Math.min(100_000, item.missedCount + skipped) };
}

export function createScheduleEvent(scheduleInput, occurrenceAt, status = "running", eventDetails = {}) {
  const schedule = normalizeSchedule(scheduleInput);
  if (!EVENT_STATES.has(status)) throw new TypeError("Scheduler event status is invalid.");
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), scheduleId: schedule.id, kind: schedule.kind, title: schedule.title,
    status, occurrenceAt: iso(occurrenceAt, "Occurrence time"), createdAt: now, updatedAt: now,
    readAt: null, browserNotificationApproved: schedule.browserNotificationApproved,
    details: details(eventDetails), workflowRunId: ""
  };
}

export function normalizeScheduleEvent(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Schedule event is invalid.");
  const status = text(input.status, 30);
  const id = text(input.id, 80);
  const scheduleId = text(input.scheduleId, 80);
  const kind = text(input.kind, 30);
  if (!EVENT_STATES.has(status) || !/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(scheduleId) || !KINDS.has(kind)) {
    throw new TypeError("Schedule event identifiers, type or state are invalid.");
  }
  const title = safe(input.title, "Schedule event title", SCHEDULER_LIMITS.title);
  if (title.length < 2) throw new TypeError("Schedule event title is invalid.");
  const createdAt = iso(input.createdAt || new Date().toISOString(), "Event creation time");
  return {
    id, scheduleId, kind, title, status,
    occurrenceAt: iso(input.occurrenceAt || createdAt, "Occurrence time"),
    createdAt, updatedAt: iso(input.updatedAt || createdAt, "Event update time"),
    readAt: input.readAt ? iso(input.readAt, "Event read time") : null,
    browserNotificationApproved: input.browserNotificationApproved === true,
    details: details(input.details), workflowRunId: text(input.workflowRunId, 80)
  };
}

export function recoverInterruptedScheduleEvents(events, recoveredAt = new Date().toISOString()) {
  const now = iso(recoveredAt, "Recovery time");
  if (!Array.isArray(events)) return [];
  return events.map((input) => {
    let event;
    try { event = normalizeScheduleEvent(input); } catch { return null; }
    if (event.status !== "running") return event;
    return {
      ...event, status: "needs_review", updatedAt: now,
      details: { ...event.details, recoveryNote: "The server restarted while this schedule was being processed. JARVIS preserved the checkpoint and will not replay the operation automatically." }
    };
  }).filter(Boolean).slice(-SCHEDULER_LIMITS.events);
}

export function getPendingTaskSummary(tasks, now = new Date().toISOString()) {
  const nowMs = Date.parse(iso(now, "Current time"));
  const pending = (Array.isArray(tasks) ? tasks : []).filter((task) => task && task.done !== true);
  const overdue = pending.filter((task) => task.dueAt && Number.isFinite(Date.parse(task.dueAt)) && Date.parse(task.dueAt) < nowMs);
  return {
    pending: pending.length, overdue: overdue.length,
    highPriority: pending.filter((task) => task.priority === "high").length,
    upcoming: pending.filter((task) => task.dueAt && Date.parse(task.dueAt) >= nowMs).length,
    taskIds: overdue.slice(0, 10).map((task) => text(task.id, 80))
  };
}

export const SCHEDULER_KINDS = Object.freeze([...KINDS]);
