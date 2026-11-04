import test from "node:test";
import assert from "node:assert/strict";
import {
  getAnalyticsDateRange,
  getTopVideosAnalytics,
  getVideoRetentionAnalytics,
  normalizeAnalyticsDays
} from "../services/youtube-analytics.js";

test("YouTube analytics date windows are restricted and end on the last complete UTC day", () => {
  assert.equal(normalizeAnalyticsDays("7"), 7);
  assert.equal(normalizeAnalyticsDays("90"), 90);
  assert.equal(normalizeAnalyticsDays("365"), 28);
  assert.deepEqual(getAnalyticsDateRange(7, new Date("2026-11-04T18:00:00.000Z")), {
    startDate: "2026-10-28",
    endDate: "2026-11-03",
    days: 7
  });
});

test("top-video analytics query is read-only and normalizes numeric report fields", async () => {
  let requestUrl = "";
  let authorization = "";
  const result = await getTopVideosAnalytics({
    accessToken: "temporary-read-only-access-token-value",
    days: 28,
    now: new Date("2026-11-04T12:00:00.000Z"),
    fetchImpl: async (url, options) => {
      requestUrl = url;
      authorization = options.headers.Authorization;
      return new Response(JSON.stringify({
        columnHeaders: [
          { name: "video", columnType: "DIMENSION" },
          { name: "views", columnType: "METRIC" },
          { name: "estimatedMinutesWatched", columnType: "METRIC" },
          { name: "averageViewDuration", columnType: "METRIC" },
          { name: "averageViewPercentage", columnType: "METRIC" },
          { name: "likes", columnType: "METRIC" },
          { name: "comments", columnType: "METRIC" },
          { name: "subscribersGained", columnType: "METRIC" }
        ],
        rows: [["abcDEF_1234", "120", "340.5", "170", "52.5", "9", "2", "1"]]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const url = new URL(requestUrl);
  assert.equal(url.origin, "https://youtubeanalytics.googleapis.com");
  assert.equal(url.pathname, "/v2/reports");
  assert.equal(url.searchParams.get("ids"), "channel==MINE");
  assert.equal(url.searchParams.get("dimensions"), "video");
  assert.equal(url.searchParams.get("sort"), "-views");
  assert.equal(url.searchParams.get("startDate"), "2026-10-08");
  assert.equal(url.searchParams.get("endDate"), "2026-11-03");
  assert.equal(authorization, "Bearer temporary-read-only-access-token-value");
  assert.equal(result.readOnly, true);
  assert.equal(result.items[0].videoId, "abcDEF_1234");
  assert.equal(result.items[0].views, 120);
  assert.equal(result.items[0].averageViewPercentage, 52.5);
});

test("retention reports are constrained to a selected video ID", async () => {
  let requestUrl = "";
  const result = await getVideoRetentionAnalytics({
    accessToken: "temporary-read-only-access-token-value",
    videoId: "abcDEF_1234",
    days: 7,
    now: new Date("2026-11-04T12:00:00.000Z"),
    fetchImpl: async (url) => {
      requestUrl = url;
      return new Response(JSON.stringify({
        columnHeaders: [
          { name: "elapsedVideoTimeRatio" },
          { name: "audienceWatchRatio" },
          { name: "relativeRetentionPerformance" },
          { name: "startedWatching" },
          { name: "stoppedWatching" }
        ],
        rows: [[0, 1, 0.8, 1, 0], [0.5, 0.6, 0.7, 0, 1]]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const url = new URL(requestUrl);
  assert.equal(url.searchParams.get("filters"), "video==abcDEF_1234");
  assert.equal(url.searchParams.get("dimensions"), "elapsedVideoTimeRatio");
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1].audienceWatchRatio, 0.6);
  await assert.rejects(() => getVideoRetentionAnalytics({
    accessToken: "temporary-read-only-access-token-value",
    videoId: "bad id"
  }), /valid YouTube video ID/i);
});

test("YouTube Analytics service handles permission and rate-limit errors safely", async () => {
  await assert.rejects(() => getTopVideosAnalytics({
    accessToken: "temporary-read-only-access-token-value",
    fetchImpl: async () => new Response("{}", { status: 403 })
  }), /permission was denied/i);
  await assert.rejects(() => getTopVideosAnalytics({
    accessToken: "temporary-read-only-access-token-value",
    fetchImpl: async () => new Response("{}", { status: 429 })
  }), /rate limit/i);
});
