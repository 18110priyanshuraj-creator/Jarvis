import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  createYouTubePublishPreview,
  MAX_YOUTUBE_UPLOAD_BYTES,
  normalizeYouTubePublication,
  uploadYouTubeVideo,
  YOUTUBE_UPLOAD_SCOPE
} from "../services/youtube-publisher.js";

const project = {
  id: "media-project-123",
  title: "Physics basics",
  brief: "A beginner explanation of motion.",
  status: "approved"
};
const validInput = {
  fileName: "physics-basics.mp4",
  contentType: "video/mp4",
  contentLength: 1024,
  reviewed: true,
  rightsConfirmed: true,
  madeForKids: false
};

test("YouTube upload uses the dedicated least-privilege upload scope", () => {
  assert.equal(YOUTUBE_UPLOAD_SCOPE, "https://www.googleapis.com/auth/youtube.upload");
});

test("publish preview requires an approved Media Studio project and explicit review", () => {
  assert.throws(() => createYouTubePublishPreview({ ...project, status: "draft" }, validInput), /approved/i);
  assert.throws(() => createYouTubePublishPreview(project, { ...validInput, reviewed: false }), /review/i);
  assert.throws(() => createYouTubePublishPreview(project, { ...validInput, rightsConfirmed: false }), /permission/i);
});

test("publish preview defaults to private and stores a bounded confirmation preview", () => {
  const preview = createYouTubePublishPreview(project, validInput, { now: new Date("2026-11-02T12:00:00.000Z") });
  assert.equal(preview.status, "pending_confirmation");
  assert.equal(preview.privacyStatus, "private");
  assert.equal(preview.madeForKids, false);
  assert.equal(preview.confirmationPhrase, "PUBLISH");
  assert.equal(Date.parse(preview.expiresAt) - Date.parse(preview.createdAt), 10 * 60 * 1000);
  assert.equal(JSON.stringify(preview).includes("accessToken"), false);
});

test("public upload preview requires parent or guardian review", () => {
  assert.throws(() => createYouTubePublishPreview(project, {
    ...validInput,
    privacyStatus: "public",
    guardianReviewed: false
  }), /parent or guardian/i);
  const reviewed = createYouTubePublishPreview(project, {
    ...validInput,
    privacyStatus: "public",
    guardianReviewed: true
  });
  assert.equal(reviewed.privacyStatus, "public");
  assert.equal(reviewed.guardianReviewed, true);
});

test("publish preview accepts explicit privacy and audience metadata", () => {
  const preview = createYouTubePublishPreview(project, {
    ...validInput,
    privacyStatus: "unlisted",
    madeForKids: true,
    tags: ["physics", "learning"],
    categoryId: "27",
    description: "A reviewed description."
  });
  assert.equal(preview.privacyStatus, "unlisted");
  assert.equal(preview.madeForKids, true);
  assert.deepEqual(preview.tags, ["physics", "learning"]);
  assert.equal(preview.categoryId, "27");
});

test("publish preview rejects unsupported MIME types, oversized files and missing audience declaration", () => {
  assert.throws(() => createYouTubePublishPreview(project, { ...validInput, contentType: "application/pdf" }), /MP4, WebM/i);
  assert.throws(() => createYouTubePublishPreview(project, { ...validInput, contentLength: MAX_YOUTUBE_UPLOAD_BYTES + 1 }), /256 MiB/i);
  assert.throws(() => createYouTubePublishPreview(project, { ...validInput, madeForKids: undefined }), /made for kids/i);
  assert.throws(() => createYouTubePublishPreview(project, { ...validInput, tags: ["x".repeat(31)] }), /30 characters/i);
});

test("publication records normalize to safe fields and reject invalid states", () => {
  const preview = createYouTubePublishPreview(project, validInput);
  const normalized = normalizeYouTubePublication({ ...preview, videoId: "abcdef12345", uploadStatus: "uploaded" });
  assert.equal(normalized.videoId, "abcdef12345");
  assert.equal(normalized.videoUrl, "https://www.youtube.com/watch?v=abcdef12345");
  assert.throws(() => normalizeYouTubePublication({ ...preview, status: "unknown" }), /invalid/i);
});

test("resumable upload initializes metadata then streams the exact bounded video body", async () => {
  const preview = createYouTubePublishPreview(project, validInput, { now: new Date("2026-11-02T12:00:00.000Z") });
  const calls = [];
  const fakeFetch = async (url, request) => {
    calls.push({ url, request });
    if (calls.length === 1) {
      assert.equal(request.method, "POST");
      assert.match(url, /notifySubscribers=false/);
      assert.equal(request.headers.Authorization, "Bearer server-access-token");
      const metadata = JSON.parse(request.body);
      assert.equal(metadata.snippet.title, "Physics basics");
      assert.equal(metadata.status.privacyStatus, "private");
      return new Response(null, { status: 200, headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=session" } });
    }
    assert.equal(request.method, "PUT");
    assert.equal(request.headers["Content-Length"], "1024");
    assert.equal(request.headers["Content-Type"], "video/mp4");
    assert.ok(request.body instanceof Readable);
    return new Response(JSON.stringify({
      id: "abcdef12345",
      snippet: { title: "Physics basics" },
      status: { privacyStatus: "private", uploadStatus: "uploaded" }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await uploadYouTubeVideo({
    publication: preview,
    accessToken: "server-access-token",
    body: Readable.from(Buffer.alloc(1024)),
    fetchImpl: fakeFetch
  });
  assert.equal(calls.length, 2);
  assert.equal(result.videoId, "abcdef12345");
  assert.equal(result.uploadStatus, "uploaded");
  assert.equal(result.videoUrl, "https://www.youtube.com/watch?v=abcdef12345");
  assert.equal(JSON.stringify(result).includes("session"), false);
});

test("resumable upload refuses an untrusted session URL before sending video bytes", async () => {
  const preview = createYouTubePublishPreview(project, validInput);
  let calls = 0;
  await assert.rejects(() => uploadYouTubeVideo({
    publication: preview,
    accessToken: "server-access-token",
    body: Readable.from(Buffer.alloc(1024)),
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 200, headers: { Location: "https://attacker.example/upload" } });
    }
  }), /invalid resumable/i);
  assert.equal(calls, 1);
});


test("resumable upload accepts only Google's exact YouTube upload endpoint", async () => {
  const preview = createYouTubePublishPreview(project, validInput);
  const untrusted = [
    "https://attacker.example/upload?upload_id=session",
    "https://evil.googleapis.com/upload/youtube/v3/videos?upload_id=session",
    "https://www.googleapis.com.evil.example/upload/youtube/v3/videos?upload_id=session",
    "https://www.googleapis.com/other/path?upload_id=session",
    "http://www.googleapis.com/upload/youtube/v3/videos?upload_id=session",
    "https://www.googleapis.com/upload/youtube/v3/videos"
  ];
  for (const location of untrusted) {
    let calls = 0;
    await assert.rejects(() => uploadYouTubeVideo({
      publication: preview,
      accessToken: "server-access-token",
      body: Readable.from(Buffer.alloc(1024)),
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 200, headers: { Location: location } });
      }
    }), /invalid resumable/i, location);
    assert.equal(calls, 1, "untrusted upload URL must be rejected before sending video bytes");
  }
});

test("resumable upload does not retry when video bytes may already have been sent", async () => {
  const preview = createYouTubePublishPreview(project, validInput);
  let calls = 0;
  await assert.rejects(async () => {
    try {
      await uploadYouTubeVideo({
        publication: preview,
        accessToken: "server-access-token",
        body: Readable.from(Buffer.alloc(1024)),
        fetchImpl: async (_url, request) => {
          calls += 1;
          if (calls === 1) return new Response(null, { status: 200, headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=session" } });
          throw new Error("network disconnect");
        }
      });
    } catch (error) {
      assert.equal(error.uploadStarted, true);
      throw error;
    }
  }, /Check YouTube Studio/i);
  assert.equal(calls, 2);
});
