import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOOGLE_DRIVE_METADATA_SCOPE,
  YOUTUBE_UPLOAD_SCOPE,
  encryptSecret,
  normalizeGoogleOAuthConnection
} from "../services/oauth.js";
import { approveMediaProject, normalizeMediaProject } from "../services/media-engine.js";
import { createYouTubePublishPreview } from "../services/youtube-publisher.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokenKey = Buffer.alloc(32, 11).toString("base64");
const envForEncryption = { JARVIS_TOKEN_ENCRYPTION_KEY: tokenKey };
const videoBytes = Buffer.from("phase-18-demo-video");
const project = approveMediaProject(normalizeMediaProject({
  id: "phase18-approved-project",
  title: "Phase 18 route test",
  brief: "A short general-audience educational video for testing the upload workflow.",
  format: "vertical-short",
  platform: "youtube-shorts",
  language: "en-IN",
  tone: "clear",
  audience: "General audience",
  scenes: [
    { heading: "Introduction", voiceover: "Welcome.", onScreenText: "Introduction", visualPrompt: "A simple title card.", durationSeconds: 5 },
    { heading: "Conclusion", voiceover: "That is the key idea.", onScreenText: "Conclusion", visualPrompt: "A simple recap card.", durationSeconds: 5 }
  ]
}));
const previewInput = {
  fileName: "phase-18-demo.mp4",
  contentType: "video/mp4",
  contentLength: videoBytes.length,
  reviewed: true,
  rightsConfirmed: true,
  madeForKids: false,
  privacyStatus: "private"
};

let child;
let baseUrl;
let cookie = "";
let tempDir;
let childOutput = "";

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = address.port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(route, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  return fetch(baseUrl + route, { ...options, headers });
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-youtube-route-test-"));
  const now = new Date().toISOString();
  const connection = normalizeGoogleOAuthConnection({
    provider: "google_drive",
    encryptedRefreshToken: encryptSecret("phase18-test-refresh-token", {
      env: envForEncryption,
      purpose: "google-drive-refresh-token"
    }),
    grantedScopes: [GOOGLE_DRIVE_METADATA_SCOPE, YOUTUBE_UPLOAD_SCOPE],
    connectedAt: now,
    updatedAt: now
  });
  const interruptedPreview = createYouTubePublishPreview(project, previewInput);
  const interruptedPublication = {
    ...interruptedPreview,
    id: "11111111-1111-4111-8111-111111111111",
    status: "uploading"
  };
  await fs.writeFile(path.join(tempDir, "state.json"), JSON.stringify({
    mediaProjects: [project],
    oauthConnections: [connection],
    youtubePublications: [interruptedPublication]
  }), "utf8");

  const port = await freePort();
  baseUrl = "http://127.0.0.1:" + port;
  const mockPath = fileURLToPath(new URL("./helpers/mock-youtube-google.js", import.meta.url));
  child = spawn(process.execPath, ["--import", mockPath, "server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      JARVIS_PASSWORD: "phase18-test-password",
      JARVIS_DATA_DIR: tempDir,
      DATABASE_URL: "",
      JARVIS_AI_BASE_URL: "",
      JARVIS_AI_API_KEY: "",
      JARVIS_AI_MODEL: "",
      JARVIS_AI_ENABLED: "false",
      JARVIS_AI_CHAT_ENABLED: "false",
      JARVIS_AI_PLANNER_ENABLED: "false",
      JARVIS_SEARCH_BASE_URL: "",
      JARVIS_SEARCH_API_KEY: "",
      JARVIS_SEARCH_ENABLED: "false",
      JARVIS_PAGE_READ_ENABLED: "false",
      JARVIS_GITHUB_TOKEN: "",
      JARVIS_GOOGLE_DRIVE_ACCESS_TOKEN: "",
      JARVIS_TELEGRAM_BOT_TOKEN: "",
      JARVIS_ELEVENLABS_API_KEY: "",
      JARVIS_TELEGRAM_ALLOWED_CHAT_IDS: "",
      JARVIS_TOKEN_ENCRYPTION_KEY: tokenKey,
      JARVIS_GOOGLE_OAUTH_CLIENT_ID: "phase18-test-client.apps.exampleusercontent.com",
      JARVIS_GOOGLE_OAUTH_CLIENT_SECRET: "phase18-test-client-secret",
      JARVIS_GOOGLE_OAUTH_REDIRECT_URI: "https://jarvis.example.test/api/integrations/google_drive/oauth/callback"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error("JARVIS YouTube test server exited early:\n" + childOutput);
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) { ready = true; break; }
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("JARVIS YouTube test server did not start:\n" + childOutput);
  const login = await request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "phase18-test-password" })
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^jarvis_session=/);
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit").catch(() => {});
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2500))]);
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test("YouTube upload routes verify approval, recover interrupted state, validate bytes and persist a confirmed receipt", async () => {
  const unauthenticated = await fetch(baseUrl + "/api/youtube/status");
  assert.equal(unauthenticated.status, 401);

  const statusResponse = await request("/api/youtube/status");
  assert.equal(statusResponse.status, 200);
  const initialStatus = await statusResponse.json();
  assert.equal(initialStatus.canUpload, true);
  const recovered = initialStatus.publications.find((item) => item.id === "11111111-1111-4111-8111-111111111111");
  assert.equal(recovered?.status, "needs_review", "an interrupted upload must require owner review after restart");

  const previewResponse = await request("/api/youtube/previews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: project.id, ...previewInput })
  });
  assert.equal(previewResponse.status, 201, await previewResponse.clone().text());
  const { preview } = await previewResponse.json();
  assert.equal(preview.status, "pending_confirmation");
  assert.equal(preview.privacyStatus, "private");

  const tooShort = Buffer.from("short");
  const wrongSize = await request("/api/youtube/publications/" + encodeURIComponent(preview.id) + "/upload", {
    method: "POST",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(tooShort.length),
      "X-Jarvis-Confirmation": "PUBLISH"
    },
    body: tooShort
  });
  assert.equal(wrongSize.status, 400);

  const wrongType = await request("/api/youtube/publications/" + encodeURIComponent(preview.id) + "/upload", {
    method: "POST",
    headers: {
      "Content-Type": "video/webm",
      "Content-Length": String(videoBytes.length),
      "X-Jarvis-Confirmation": "PUBLISH"
    },
    body: videoBytes
  });
  assert.equal(wrongType.status, 415);

  const upload = await request("/api/youtube/publications/" + encodeURIComponent(preview.id) + "/upload", {
    method: "POST",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(videoBytes.length),
      "X-Jarvis-Confirmation": "PUBLISH"
    },
    body: videoBytes
  });
  assert.equal(upload.status, 201, await upload.clone().text());
  const result = await upload.json();
  assert.equal(result.publication.status, "uploaded");
  assert.equal(result.publication.videoId, "phase18video01");
  assert.equal(result.publication.videoUrl, "https://www.youtube.com/watch?v=phase18video01");
  assert.equal(result.publication.privacyStatus, "private");

  const duplicate = await request("/api/youtube/publications/" + encodeURIComponent(preview.id) + "/upload", {
    method: "POST",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(videoBytes.length),
      "X-Jarvis-Confirmation": "PUBLISH"
    },
    body: videoBytes
  });
  assert.equal(duplicate.status, 409);

  const finalStatus = await request("/api/youtube/status");
  const finalPayload = await finalStatus.json();
  const saved = finalPayload.publications.find((item) => item.id === preview.id);
  assert.equal(saved?.status, "uploaded");
  assert.equal(saved?.videoId, "phase18video01");
});
