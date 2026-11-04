const REPORTS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";
const DEFAULT_DAYS = 28;
const ALLOWED_DAYS = new Set([7, 28, 90]);
const SAFE_VIDEO_ID = /^[A-Za-z0-9_-]{6,64}$/;

function requireAccessToken(value) {
  if (typeof value !== "string" || value.length < 20 || value.length > 8192) {
    throw new TypeError("A valid YouTube Analytics access token is required.");
  }
  return value;
}

export function normalizeAnalyticsDays(value) {
  const days = Number.parseInt(String(value ?? DEFAULT_DAYS), 10);
  return ALLOWED_DAYS.has(days) ? days : DEFAULT_DAYS;
}

export function getAnalyticsDateRange(days = DEFAULT_DAYS, now = new Date()) {
  const count = normalizeAnalyticsDays(days);
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (count - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    days: count
  };
}

function parseRows(payload) {
  if (!payload || !Array.isArray(payload.columnHeaders) || !Array.isArray(payload.rows)) {
    throw new Error("YouTube Analytics returned an unexpected report format.");
  }
  const columns = payload.columnHeaders.map((item) => String(item?.name || ""));
  if (columns.some((name) => !name)) throw new Error("YouTube Analytics returned unnamed report columns.");
  return payload.rows.slice(0, 200).map((row) => {
    if (!Array.isArray(row) || row.length !== columns.length) return null;
    return Object.fromEntries(columns.map((name, index) => [name, row[index]]));
  }).filter(Boolean);
}

async function queryReport(params, accessToken, fetchImpl = fetch) {
  const token = requireAccessToken(accessToken);
  const url = new URL(REPORTS_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json"
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("YouTube Analytics timed out. Try again later.");
    }
    throw new Error("Could not connect to YouTube Analytics.");
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("YouTube Analytics permission expired. Reconnect the read-only permission.");
    if (response.status === 403) throw new Error("YouTube Analytics access was denied. Check the read-only permission and channel eligibility.");
    if (response.status === 429) throw new Error("YouTube Analytics rate limit reached. Try again later.");
    throw new Error("YouTube Analytics could not return this report (HTTP " + response.status + ").");
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error("YouTube Analytics returned unreadable report data."); }
  return { columns: payload.columnHeaders || [], rows: parseRows(payload) };
}

export async function getTopVideosAnalytics(options = {}) {
  const range = getAnalyticsDateRange(options.days, options.now || new Date());
  const report = await queryReport({
    ids: "channel==MINE",
    startDate: range.startDate,
    endDate: range.endDate,
    metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,subscribersGained",
    dimensions: "video",
    sort: "-views",
    maxResults: 25
  }, options.accessToken, options.fetchImpl || fetch);

  const items = report.rows.map((row) => ({
    videoId: String(row.video || ""),
    views: Number(row.views) || 0,
    estimatedMinutesWatched: Number(row.estimatedMinutesWatched) || 0,
    averageViewDurationSeconds: Number(row.averageViewDuration) || 0,
    averageViewPercentage: Number(row.averageViewPercentage) || 0,
    likes: Number(row.likes) || 0,
    comments: Number(row.comments) || 0,
    subscribersGained: Number(row.subscribersGained) || 0
  })).filter((item) => SAFE_VIDEO_ID.test(item.videoId));

  return { range, items, reportType: "top-videos", readOnly: true };
}

export async function getVideoRetentionAnalytics(options = {}) {
  const videoId = String(options.videoId || "").trim();
  if (!SAFE_VIDEO_ID.test(videoId)) throw new TypeError("Choose a valid YouTube video ID.");
  const range = getAnalyticsDateRange(options.days, options.now || new Date());
  const report = await queryReport({
    ids: "channel==MINE",
    startDate: range.startDate,
    endDate: range.endDate,
    metrics: "audienceWatchRatio,relativeRetentionPerformance,startedWatching,stoppedWatching",
    dimensions: "elapsedVideoTimeRatio",
    filters: "video==" + videoId,
    sort: "elapsedVideoTimeRatio"
  }, options.accessToken, options.fetchImpl || fetch);

  const items = report.rows.map((row) => ({
    elapsedVideoTimeRatio: Number(row.elapsedVideoTimeRatio) || 0,
    audienceWatchRatio: Number(row.audienceWatchRatio) || 0,
    relativeRetentionPerformance: Number(row.relativeRetentionPerformance) || 0,
    startedWatching: Number(row.startedWatching) || 0,
    stoppedWatching: Number(row.stoppedWatching) || 0
  })).filter((item) => Number.isFinite(item.elapsedVideoTimeRatio));

  return { range, videoId, items, reportType: "audience-retention", readOnly: true };
}

export const YOUTUBE_ANALYTICS_LIMITS = Object.freeze({
  allowedDays: [...ALLOWED_DAYS],
  topVideos: 25,
  retentionSegments: 200,
  readOnly: true
});
