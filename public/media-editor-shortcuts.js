export const MEDIA_EDITOR_SEEK_SECONDS = 5;
export const MEDIA_EDITOR_FRAME_SECONDS = 1 / 30;

export function resolveMediaEditorShortcut(event, { isEditing = false } = {}) {
  if (!event || isEditing || event.defaultPrevented || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey) return null;

  const key = String(event.key || "").toLowerCase();
  if (key === " " || key === "k") return { action: "toggle-playback" };
  if (key === "j") return { action: "seek", deltaSeconds: -MEDIA_EDITOR_SEEK_SECONDS };
  if (key === "l") return { action: "seek", deltaSeconds: MEDIA_EDITOR_SEEK_SECONDS };
  if (key === "arrowleft") return { action: "seek", deltaSeconds: -MEDIA_EDITOR_FRAME_SECONDS };
  if (key === "arrowright") return { action: "seek", deltaSeconds: MEDIA_EDITOR_FRAME_SECONDS };
  if (key === "home") return { action: "seek-start" };
  if (key === "end") return { action: "seek-end" };
  return null;
}

export function clampMediaEditorTime(currentSeconds, deltaSeconds, durationSeconds) {
  const duration = Math.max(0, Number.isFinite(Number(durationSeconds)) ? Number(durationSeconds) : 0);
  const current = Math.max(0, Math.min(duration,
    Number.isFinite(Number(currentSeconds)) ? Number(currentSeconds) : 0));
  const delta = Number.isFinite(Number(deltaSeconds)) ? Number(deltaSeconds) : 0;
  return Math.max(0, Math.min(duration, current + delta));
}
