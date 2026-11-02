import crypto from "node:crypto";

export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const MAX_YOUTUBE_UPLOAD_BYTES = 256 * 1024 * 1024;
export const YOUTUBE_PREVIEW_TTL_MS = 10 * 60 * 1000;
export const YOUTUBE_UPLOAD_MIME_TYPES = Object.freeze([
  "video/mp4",
  "video/webm",
  "video/quicktime"
]);
const PUBLICATION_STATES = new Set([
  "pending_confirmation", "uploading", "uploaded", "needs_review", "failed", "cancelled", "expired"
]);
const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 30;
const MAX_DESCRIPTION = 5000;
const MAX_TITLE = 100;

function cleanText(value, maxLength) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\u0000/g, "").trim().slice(0, maxLength)
    : "";
}

function safeDate(value, fallback) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeTags(value) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) throw new TypeError("Tags must be supplied as a list.");
  if (value.length > MAX_TAGS) throw new TypeError("Use no more than 30 video tags.");
  const tags = value.map((tag) => typeof tag === "string" ? tag.normalize("NFKC").trim() : "");
  if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) throw new TypeError("Each tag must be 30 characters or fewer.");
  const normalizedTags = tags.map((tag) => cleanText(tag, MAX_TAG_LENGTH)).filter(Boolean);
  if (normalizedTags.join("").length > 500) throw new TypeError("The combined tag text is too long.");
  return [...new Set(normalizedTags)];
}

export function normalizeYouTubePublication(input = {}) {
  const status = PUBLICATION_STATES.has(input.status) ? input.status : "";
  const contentType = cleanText(input.contentType, 80).toLowerCase();
  const contentLength = Number(input.contentLength);
  const projectId = cleanText(input.projectId, 80);
  const title = cleanText(input.title, MAX_TITLE);
  const description = cleanText(input.description, MAX_DESCRIPTION);
  const fileName = cleanText(input.fileName, 160);
  const privacyStatus = ["private", "unlisted", "public"].includes(input.privacyStatus)
    ? input.privacyStatus
    : "";
  const guardianReviewed = input.guardianReviewed === true;
  if (!status || !projectId || !title || !fileName || !YOUTUBE_UPLOAD_MIME_TYPES.includes(contentType) ||
      !Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_YOUTUBE_UPLOAD_BYTES ||
      !privacyStatus || typeof input.madeForKids !== "boolean" ||
      (privacyStatus === "public" && !guardianReviewed)) {
    throw new TypeError("The saved YouTube publication record is invalid.");
  }
  const createdAt = safeDate(input.createdAt, new Date().toISOString());
  const expiresAt = safeDate(input.expiresAt, new Date(Date.parse(createdAt) + YOUTUBE_PREVIEW_TTL_MS).toISOString());
  const tags = normalizeTags(input.tags);
  const videoId = /^[A-Za-z0-9_-]{6,32}$/.test(cleanText(input.videoId, 32)) ? cleanText(input.videoId, 32) : "";
  const uploadStatus = ["uploaded", "processed", "failed", "rejected", "deleted"].includes(input.uploadStatus)
    ? input.uploadStatus
    : "";
  const safeError = cleanText(input.error, 240);
  return {
    id: /^[a-f0-9-]{36}$/i.test(cleanText(input.id, 80)) ? input.id : crypto.randomUUID(),
    projectId,
    title,
    description,
    tags,
    categoryId: /^\d{1,4}$/.test(cleanText(input.categoryId, 4)) ? cleanText(input.categoryId, 4) : "",
    privacyStatus,
    madeForKids: input.madeForKids,
    guardianReviewed,
    fileName,
    contentType,
    contentLength,
    status,
    confirmationPhrase: status === "pending_confirmation" ? "PUBLISH" : "",
    createdAt,
    expiresAt,
    ...(videoId ? { videoId, videoUrl: "https://www.youtube.com/watch?v=" + videoId } : {}),
    ...(uploadStatus ? { uploadStatus } : {}),
    ...(safeError ? { error: safeError } : {}),
    ...(Number.isFinite(Date.parse(input.uploadedAt || "")) ? { uploadedAt: new Date(input.uploadedAt).toISOString() } : {})
  };
}

export function createYouTubePublishPreview(project, input = {}, options = {}) {
  if (!project || project.status !== "approved" || typeof project.id !== "string") {
    throw new Error("Only an approved Media Studio project can be prepared for YouTube.");
  }
  const title = cleanText(input.title || project.title, MAX_TITLE);
  const description = cleanText(input.description || project.brief, MAX_DESCRIPTION);
  const fileName = cleanText(input.fileName, 160);
  const contentType = cleanText(input.contentType, 80).toLowerCase();
  const contentLength = Number(input.contentLength);
  const privacyStatus = ["private", "unlisted", "public"].includes(input.privacyStatus)
    ? input.privacyStatus
    : "private";
  if (!title) throw new TypeError("A YouTube video title is required.");
  if (!fileName) throw new TypeError("Choose a video file first.");
  if (!YOUTUBE_UPLOAD_MIME_TYPES.includes(contentType)) {
    throw new TypeError("Choose an MP4, WebM or QuickTime video file.");
  }
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_YOUTUBE_UPLOAD_BYTES) {
    throw new TypeError("The selected video must be between 1 byte and 256 MiB.");
  }
  if (input.reviewed !== true || input.rightsConfirmed !== true) {
    throw new Error("Review the details and confirm you have permission to upload this video.");
  }
  if (typeof input.madeForKids !== "boolean") {
    throw new TypeError("Choose whether this video is made for kids. This declaration is required.");
  }
  const guardianReviewed = input.guardianReviewed === true;
  if (privacyStatus === "public" && !guardianReviewed) {
    throw new Error("A parent or guardian must review and approve public visibility before JARVIS can prepare this upload.");
  }
  const now = options.now instanceof Date ? options.now : new Date();
  return normalizeYouTubePublication({
    id: crypto.randomUUID(),
    projectId: project.id,
    title,
    description,
    tags: normalizeTags(input.tags),
    categoryId: cleanText(input.categoryId, 4),
    privacyStatus,
    madeForKids: input.madeForKids,
    guardianReviewed,
    fileName,
    contentType,
    contentLength,
    status: "pending_confirmation",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + YOUTUBE_PREVIEW_TTL_MS).toISOString()
  });
}

function providerMessage(payload, fallback) {
  const detail = cleanText(payload?.error?.message, 180);
  return detail ? fallback + " " + detail : fallback;
}

function validateResumableUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com" ||
      url.pathname !== "/upload/youtube/v3/videos" ||
      url.username || url.password || url.hash || !url.searchParams.get("upload_id")) return null;
  return url.toString();
}

async function responseJson(response) {
  try { return await response.json(); } catch { return {}; }
}

export async function uploadYouTubeVideo(options = {}) {
  const publication = normalizeYouTubePublication(options.publication);
  const accessToken = cleanText(options.accessToken, 4096);
  const fetchImpl = options.fetchImpl || fetch;
  const body = options.body;
  if (!accessToken) throw new Error("A YouTube upload access token is not available.");
  if (!body) throw new TypeError("The video upload body is missing.");
  const metadata = {
    snippet: {
      title: publication.title,
      description: publication.description,
      ...(publication.tags.length ? { tags: publication.tags } : {}),
      ...(publication.categoryId ? { categoryId: publication.categoryId } : {})
    },
    status: {
      privacyStatus: publication.privacyStatus,
      selfDeclaredMadeForKids: publication.madeForKids
    }
  };
  let initialized;
  try {
    initialized = await fetchImpl(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(publication.contentLength),
          "X-Upload-Content-Type": publication.contentType
        },
        body: JSON.stringify(metadata),
        redirect: "error",
        signal: AbortSignal.timeout(15_000)
      }
    );
  } catch {
    const error = new Error("YouTube could not start the upload. Nothing was confirmed as uploaded.");
    error.uploadStarted = false;
    throw error;
  }
  if (!initialized.ok) {
    const payload = await responseJson(initialized);
    const error = new Error(providerMessage(payload, "YouTube rejected the upload request."));
    error.uploadStarted = false;
    throw error;
  }
  const uploadUrl = validateResumableUrl(initialized.headers.get("location"));
  if (!uploadUrl) {
    const error = new Error("YouTube returned an invalid resumable upload location. No video bytes were sent.");
    error.uploadStarted = false;
    throw error;
  }

  let uploaded;
  try {
    uploaded = await fetchImpl(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": publication.contentType,
        "Content-Length": String(publication.contentLength)
      },
      body,
      duplex: "half",
      redirect: "error",
      signal: AbortSignal.timeout(30 * 60 * 1000)
    });
  } catch {
    const error = new Error("The connection ended during upload. Check YouTube Studio before trying again; JARVIS will not retry automatically.");
    error.uploadStarted = true;
    throw error;
  }
  if (!uploaded.ok) {
    const payload = await responseJson(uploaded);
    const error = new Error(providerMessage(payload, "YouTube did not confirm the video upload. Check YouTube Studio before trying again."));
    error.uploadStarted = true;
    throw error;
  }
  const payload = await responseJson(uploaded);
  const videoId = cleanText(payload?.id, 32);
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(videoId)) {
    const error = new Error("YouTube received the upload but did not return a usable video ID. Check YouTube Studio before trying again.");
    error.uploadStarted = true;
    throw error;
  }
  return {
    videoId,
    videoUrl: "https://www.youtube.com/watch?v=" + videoId,
    title: cleanText(payload?.snippet?.title, MAX_TITLE) || publication.title,
    privacyStatus: ["private", "unlisted", "public"].includes(payload?.status?.privacyStatus)
      ? payload.status.privacyStatus
      : publication.privacyStatus,
    uploadStatus: ["uploaded", "processed", "failed", "rejected", "deleted"].includes(payload?.status?.uploadStatus)
      ? payload.status.uploadStatus
      : "uploaded",
    uploadedAt: new Date().toISOString()
  };
}
