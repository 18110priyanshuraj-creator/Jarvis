/**
 * Small, pure validation layer for browser-rendered media exports.
 * The browser probe supplies measured metadata; this module never trusts
 * project settings as proof of what was actually rendered.
 */
export function assessMediaExport({
  blobSizeBytes,
  mimeType,
  actualWidth,
  actualHeight,
  actualDurationSeconds,
  expectedWidth,
  expectedHeight,
  expectedDurationSeconds
} = {}) {
  const issues = [];
  const numeric = (value) => typeof value === "number" && Number.isFinite(value);

  if (!numeric(blobSizeBytes) || blobSizeBytes < 1024) {
    issues.push("The exported file is empty or too small to be a valid video.");
  }

  const normalizedMime = typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
  if (normalizedMime && !normalizedMime.startsWith("video/")) {
    issues.push("The exported file has an unexpected media type.");
  }

  if (!numeric(actualWidth) || !numeric(actualHeight) || actualWidth <= 0 || actualHeight <= 0) {
    issues.push("The browser could not read valid video dimensions.");
  } else if (actualWidth !== expectedWidth || actualHeight !== expectedHeight) {
    issues.push(`Expected ${expectedWidth}×${expectedHeight}, but the video reports ${actualWidth}×${actualHeight}.`);
  }

  if (!numeric(actualDurationSeconds) || actualDurationSeconds <= 0) {
    issues.push("The browser could not read a valid video duration.");
  } else if (numeric(expectedDurationSeconds) && expectedDurationSeconds > 0) {
    const toleranceSeconds = Math.max(1.5, expectedDurationSeconds * 0.01);
    if (Math.abs(actualDurationSeconds - expectedDurationSeconds) > toleranceSeconds) {
      issues.push(`Expected about ${expectedDurationSeconds.toFixed(1)}s, but the video reports ${actualDurationSeconds.toFixed(1)}s.`);
    }
  }

  return {
    verified: issues.length === 0,
    issues,
    blobSizeBytes: numeric(blobSizeBytes) ? blobSizeBytes : null,
    mimeType: normalizedMime || null,
    actualWidth: numeric(actualWidth) ? actualWidth : null,
    actualHeight: numeric(actualHeight) ? actualHeight : null,
    actualDurationSeconds: numeric(actualDurationSeconds) ? actualDurationSeconds : null
  };
}
