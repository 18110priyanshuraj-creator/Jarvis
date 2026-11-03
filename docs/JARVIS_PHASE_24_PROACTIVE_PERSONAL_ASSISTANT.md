# JARVIS Phase 24 — Proactive Personal Assistant

**Status:** IN_PROGRESS (implementation and automated CI pending)  
**Branch:** feat/phase-24-proactive-personal-assistant  
**Product boundary:** One authenticated JARVIS service and one Tasks workspace; no separate app or scheduler service.

## Objective

Give JARVIS durable, user-controlled reminders and recurring schedules, keep pending work visible, and report missed or interrupted scheduled operations honestly.

## Implemented scope

- Reminder schedules with one-time, daily and weekly recurrence.
- Scheduled public-web research through the existing trusted research integration.
- Daily pending-task summaries.
- Recurring execution of a workflow only when that workflow was already validated and explicitly approved.
- Low/normal/high task and schedule priorities.
- Pending, overdue, upcoming and high-priority task counts.
- Explicit per-schedule opt-in for browser notifications. In-app event history remains available without browser permission.
- Pause, resume and cancel controls.
- Durable schedule and event records included in user data export.
- Single-run locking, pre-operation checkpoints, bounded event history and interruption recovery to needs_review without automatic replay.
- Task priority and due-date editing through the existing Tasks screen.

## Runtime and background limitation

The scheduler is hosted by the existing JARVIS server process and checks due schedules on a 30-second interval. It runs only while that server process is available. If the process is stopped or suspended beyond the five-minute delivery grace, the occurrence is recorded as missed and recurring schedules advance without replaying a backlog.

This is not Android WorkManager, an always-on Android service, a push-notification provider or a guarantee that a paused free hosting instance will wake. Browser notifications require the browser to support them, the user to grant permission, and the individual schedule to opt in. The event history is the durable record.

## Safety boundaries

- Only public research via the existing trusted search integration; unavailable search creates a blocked event.
- Scheduled workflows must already be approved and continue to use their existing checkpoints and review gates.
- No message sending, purchasing, payment, publishing or privileged device action is added.
- A running event recovered after restart becomes needs_review and is never silently repeated.
- Notification permission is optional and user initiated.
- Schedule records reject credentials and email addresses in user-entered fields.

## Verification checklist

- [ ] Scheduler service unit tests pass.
- [ ] Authenticated schedule API integration tests pass.
- [ ] Schedule persistence/export verified.
- [ ] Pause/resume/cancel verified.
- [ ] Approved workflow restriction verified.
- [ ] Node regression suite and dependency audit pass.
- [ ] Android Companion build/APK verification pass.
- [ ] Post-merge main CI passes.
- [ ] Physical Galaxy Tab A9 notification and background tests — Phase 31.

## Known limitations

- Server-process scheduling is not guaranteed while the server is stopped or a hosting provider suspends the process.
- Daily/weekly recurrence advances in fixed 24-hour/7-day intervals from the original occurrence; it is not a DST-aware calendar scheduler.
- Browser notifications are not a substitute for Android-native scheduled notifications.
- Automated live research requires the existing trusted search endpoint and source availability.
