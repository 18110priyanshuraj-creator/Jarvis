export const TIMELINE_SNAP_THRESHOLD_SECONDS = 0.12;

function finiteTime(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

function roundTime(value) {
  return Math.round(value * 1000) / 1000;
}

export function collectTimelineSnapPoints(project, excludeClipId = null, playheadSeconds = null) {
  const points = new Set([0]);
  const playhead = finiteTime(playheadSeconds);
  if (playhead !== null) points.add(roundTime(playhead));

  for (const track of Array.isArray(project?.tracks) ? project.tracks : []) {
    for (const clip of Array.isArray(track?.clips) ? track.clips : []) {
      if (!clip || clip.id === excludeClipId) continue;
      const start = finiteTime(clip.start);
      const duration = finiteTime(clip.duration);
      if (start === null || duration === null || duration <= 0) continue;
      points.add(roundTime(start));
      points.add(roundTime(start + duration));
    }
  }
  return [...points].sort((left, right) => left - right);
}

export function snapTimelineEdge(value, snapPoints, threshold = TIMELINE_SNAP_THRESHOLD_SECONDS) {
  const raw = finiteTime(value);
  if (raw === null) return 0;
  const limit = Math.max(0, Number(threshold) || 0);
  let closest = raw;
  let closestDistance = limit + Number.EPSILON;
  for (const pointValue of Array.isArray(snapPoints) ? snapPoints : []) {
    const point = finiteTime(pointValue);
    if (point === null) continue;
    const distance = Math.abs(point - raw);
    if (distance <= limit && distance < closestDistance) {
      closest = point;
      closestDistance = distance;
    }
  }
  return roundTime(closest);
}

export function snapTimelineMoveStart(start, duration, snapPoints, threshold = TIMELINE_SNAP_THRESHOLD_SECONDS) {
  const rawStart = finiteTime(start);
  const length = finiteTime(duration);
  if (rawStart === null || length === null) return 0;
  const candidates = [];
  for (const pointValue of Array.isArray(snapPoints) ? snapPoints : []) {
    const point = finiteTime(pointValue);
    if (point === null) continue;
    // Align the moving clip's leading edge, or its trailing edge, to another point.
    candidates.push(point, point - length);
  }
  return snapTimelineEdge(rawStart, candidates, threshold);
}
