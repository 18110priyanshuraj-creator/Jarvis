import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceSchedule, createSchedule, createScheduleEvent, getPendingTaskSummary, normalizeSchedule, normalizeScheduleEvent, recoverInterruptedScheduleEvents, setScheduleStatus, SCHEDULER_LIMITS } from "../services/scheduler.js";

const now = "2026-11-03T10:00:00.000Z";
const base = { kind: "reminder", title: "Revise physics", description: "Review units and measurements", dueAt: "2026-11-04T10:00:00.000Z", recurrence: "daily", timeZone: "Asia/Kolkata", priority: "high", browserNotificationApproved: true };

test("creates a bounded recurring schedule and normalizes it", () => {
  const item = createSchedule(base, { now });
  assert.equal(item.status, "active");
  assert.equal(item.recurrence, "daily");
  assert.equal(item.timeZone, "Asia/Kolkata");
  assert.equal(item.nextRunAt, item.dueAt);
  assert.equal(item.browserNotificationApproved, true);
  assert.equal(normalizeSchedule(item).id, item.id);
});

test("rejects past, invalid, far-future and private schedule inputs", () => {
  assert.throws(() => createSchedule({ ...base, dueAt: "2026-11-02T10:00:00Z" }, { now }), /future/i);
  assert.throws(() => createSchedule({ ...base, dueAt: "not-a-date" }, { now }), /valid date/i);
  assert.throws(() => createSchedule({ ...base, dueAt: "2028-11-03T10:00:00Z" }, { now }), /one year/i);
  assert.throws(() => createSchedule({ ...base, title: "Password: secret123" }, { now }), /credential/i);
  assert.throws(() => createSchedule({ ...base, title: "Email learner@example.com" }, { now }), /credential/i);
  assert.throws(() => createSchedule({ ...base, timeZone: "not/a-zone" }, { now }), /IANA time zone/i);
});

test("research, workflow and daily-summary schedules validate their special fields", () => {
  assert.throws(() => createSchedule({ ...base, kind: "research", query: "" }, { now }), /research needs/i);
  assert.throws(() => createSchedule({ ...base, kind: "workflow", workflowId: "" }, { now }), /approved workflow/i);
  assert.throws(() => createSchedule({ ...base, kind: "daily_summary", recurrence: "weekly" }, { now }), /daily summaries/i);
  assert.equal(createSchedule({ ...base, kind: "research", query: "Latest public AI research", recurrence: "once" }, { now }).query, "Latest public AI research");
});

test("pause, resume and cancellation enforce an explicit lifecycle", () => {
  const item = createSchedule(base, { now });
  const paused = setScheduleStatus(item, "paused", now);
  assert.equal(paused.status, "paused");
  assert.equal(setScheduleStatus(paused, "active", now).status, "active");
  const cancelled = setScheduleStatus(paused, "cancelled", now);
  assert.equal(cancelled.nextRunAt, null);
  assert.throws(() => setScheduleStatus(cancelled, "active", now), /cannot be restarted/i);
});

test("one-time schedules complete and recurring schedules advance from their occurrence", () => {
  const once = createSchedule({ ...base, recurrence: "once" }, { now });
  const completed = advanceSchedule(once, once.dueAt, once.dueAt);
  assert.equal(completed.status, "completed");
  assert.equal(completed.nextRunAt, null);
  const recurring = createSchedule(base, { now });
  const next = advanceSchedule(recurring, recurring.dueAt, recurring.dueAt);
  assert.equal(Date.parse(next.nextRunAt) - Date.parse(recurring.dueAt), 86_400_000);
});

test("recurring schedules skip missed intervals without replaying a backlog", () => {
  const item = createSchedule(base, { now });
  const next = advanceSchedule(item, item.dueAt, "2026-11-07T10:00:00.000Z");
  assert.equal(next.missedCount, 3);
  assert.equal(next.nextRunAt, "2026-11-08T10:00:00.000Z");
});

test("events sanitize details and preserve the explicit notification choice", () => {
  const item = createSchedule(base, { now });
  const event = createScheduleEvent(item, item.dueAt, "delivered", { result: "Reminder delivered", count: 3, apiKey: "must be dropped" });
  assert.equal(event.browserNotificationApproved, true);
  assert.equal(event.details.result, "Reminder delivered");
  assert.equal(Object.hasOwn(event.details, "apiKey"), false);
  assert.equal(normalizeScheduleEvent(event).id, event.id);
});

test("interrupted scheduler events require review and are never replayed", () => {
  const item = createSchedule(base, { now });
  const event = createScheduleEvent(item, item.dueAt, "running", { reason: "in progress" });
  const recovered = recoverInterruptedScheduleEvents([event], "2026-11-04T11:00:00Z")[0];
  assert.equal(recovered.status, "needs_review");
  assert.match(recovered.details.recoveryNote, /will not replay/i);
});

test("pending summary reports pending, overdue and high-priority tasks", () => {
  const summary = getPendingTaskSummary([
    { id: "a", done: false, dueAt: "2026-11-02T10:00:00Z", priority: "high" },
    { id: "b", done: false, dueAt: "2026-11-05T10:00:00Z", priority: "normal" },
    { id: "c", done: true, dueAt: "2026-11-01T10:00:00Z", priority: "high" }
  ], now);
  assert.deepEqual(summary, { pending: 2, overdue: 1, highPriority: 1, upcoming: 1, taskIds: ["a"] });
});

test("scheduler limits are conservative and bounded", () => {
  assert.equal(SCHEDULER_LIMITS.schedules, 100);
  assert.equal(SCHEDULER_LIMITS.events, 200);
});
