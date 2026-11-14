import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  return fetch(baseUrl + route, { ...options, headers });
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-test-"));
  const port = await freePort();
  baseUrl = "http://127.0.0.1:" + port;
  child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      JARVIS_PASSWORD: "test-only-password-2026",
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
      JARVIS_TELEGRAM_BOT_TOKEN: "123456789:" + "A".repeat(32),
      JARVIS_ELEVENLABS_API_KEY: "",
      JARVIS_TELEGRAM_ALLOWED_CHAT_IDS: "123456789",
      JARVIS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"),
      JARVIS_GOOGLE_OAUTH_CLIENT_ID: "local-test-client.apps.exampleusercontent.com",
      JARVIS_GOOGLE_OAUTH_CLIENT_SECRET: "local-test-client-secret",
      JARVIS_GOOGLE_OAUTH_REDIRECT_URI: "https://jarvis.example.test/api/integrations/google_drive/oauth/callback"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error("JARVIS test server exited early:\n" + childOutput);
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) { ready = true; break; }
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("JARVIS test server did not start:\n" + childOutput);
});

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit").catch(() => {});
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2500))]);
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test("health endpoint is public without disclosing configuration", async () => {
  const response = await request("/api/health", { headers: {} });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.service, "jarvis");
  assert.equal(payload.plannerAIEnabled, false);
  assert.equal(payload.conversationAIEnabled, false);
  assert.equal(payload.webResearchEnabled, false);
  assert.equal(payload.searchProvider.provider, "searxng");
  assert.equal(payload.searchProvider.configured, false);
  assert.equal(payload.pageReader.enabled, false);
  assert.equal(payload.sourceAnswer.enabled, false);
  assert.equal(payload.sourceAnswer.minimumSources, 2);
  assert.equal(payload.sourceAnswer.maximumSources, 5);
  assert.equal(payload.sourceAnswer.requiresSessionBoundPageTokens, true);
  assert.equal(payload.sourceAnswer.requiresLiveSearch, true);
  assert.equal(payload.knowledgePolicy.persistent, true);
  assert.equal(payload.knowledgePolicy.storage, "local-json-file");
  assert.equal(payload.knowledgePolicy.webResearchRequiresUserReview, true);
  assert.equal(payload.knowledgePolicy.unreviewedResearchInAssistantContext, false);
  assert.equal(payload.knowledgePolicy.rejectedResearchInAssistantContext, false);
  assert.equal(payload.knowledgePolicy.automaticSaving, false);
  assert.equal(payload.knowledgePolicy.maxItems, 300);
  assert.equal(payload.externalAI, false);
  assert.equal(payload.aiProvider.provider, "openai-compatible");
  assert.equal(payload.aiProvider.configured, false);
  assert.equal(payload.aiProvider.baseUrlConfigured, false);
  assert.equal(payload.aiProvider.model, "not-configured");
  assert.equal(Object.hasOwn(payload.aiProvider, "apiKey"), false);
  assert.equal(JSON.stringify(payload).includes("test-only-password-2026"), false);
});

test("authentication, local search, tasks, memories, and offline chat behave safely", async () => {
  const blockedState = await request("/api/state", { headers: {} });
  assert.equal(blockedState.status, 401);
  const blockedDiagnostics = await request("/api/diagnostics", { headers: {} });
  assert.equal(blockedDiagnostics.status, 401);
  const blockedKnowledge = await request("/api/knowledge", { headers: {} });
  assert.equal(blockedKnowledge.status, 401);
  const blockedDocuments = await request("/api/knowledge/documents", { headers: {} });
  assert.equal(blockedDocuments.status, 401);
  const blockedDocumentUpload = await request("/api/knowledge/documents", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: Buffer.from("unauthorized")
  });
  assert.equal(blockedDocumentUpload.status, 401);
  const blockedDocumentDownload = await request("/api/knowledge/documents/not-an-id/download", { headers: {} });
  assert.equal(blockedDocumentDownload.status, 401);
  const blockedLearningPreview = await request("/api/learning/preview", {
    method: "POST",
    headers: {},
    body: JSON.stringify({ query: "average velocity" })
  });
  assert.equal(blockedLearningPreview.status, 401);
  const blockedMemories = await request("/api/memories", { headers: {} });
  assert.equal(blockedMemories.status, 401);
  const blockedSkills = await request("/api/skills", { headers: {} });
  assert.equal(blockedSkills.status, 401);
  const blockedSkillCrucible = await request("/api/skill-crucible", { headers: {} });
  assert.equal(blockedSkillCrucible.status, 401);
  const blockedSkillProgramCreate = await request("/api/skill-crucible/programs", {
    method: "POST", headers: {}, body: JSON.stringify({})
  });
  assert.equal(blockedSkillProgramCreate.status, 401);
  const blockedAutoHeal = await request("/api/auto-heal", { headers: {} });
  assert.equal(blockedAutoHeal.status, 401);
  const blockedWorkers = await request("/api/workers", { headers: {} });
  assert.equal(blockedWorkers.status, 401);
  const blockedWorkerDispatch = await request("/api/workers/dispatch", { method: "POST", headers: {}, body: JSON.stringify({ goal: "Create a video storyboard." }) });
  assert.equal(blockedWorkerDispatch.status, 401);
  const blockedExperience = await request("/api/experience", { headers: {} });
  assert.equal(blockedExperience.status, 401);
  const blockedWorkflows = await request("/api/workflows", { headers: {} });
  assert.equal(blockedWorkflows.status, 401);
  const blockedIntegrations = await request("/api/integrations", { headers: {} });
  assert.equal(blockedIntegrations.status, 401);
  const blockedYouTubeStatus = await request("/api/youtube/status", { headers: {} });
  assert.equal(blockedYouTubeStatus.status, 401);
  const blockedYouTubePreview = await request("/api/youtube/previews", {
    method: "POST", headers: {}, body: JSON.stringify({})
  });
  assert.equal(blockedYouTubePreview.status, 401);
  const blockedYouTubeUpload = await request("/api/youtube/publications/not-an-id/upload", {
    method: "POST", headers: { "content-type": "video/mp4", "content-length": "1" }, body: Buffer.from("x")
  });
  assert.equal(blockedYouTubeUpload.status, 401);
  const blockedExport = await request("/api/export", { headers: {} });
  assert.equal(blockedExport.status, 401);
  const blockedCreatorCampaign = await request("/api/creator/campaigns", {
    method: "POST", headers: {}, body: JSON.stringify({ topic: "How solar panels work" })
  });
  assert.equal(blockedCreatorCampaign.status, 401);
  const blockedResearch = await request("/api/research", {
    method: "POST",
    headers: {},
    body: JSON.stringify({ query: "What changed in the latest science research?" })
  });
  assert.equal(blockedResearch.status, 401);
  const blockedPageRead = await request("/api/research/read", {
    method: "POST",
    headers: {},
    body: JSON.stringify({ readToken: "not-a-token" })
  });
  assert.equal(blockedPageRead.status, 401);

  const blockedSourceAnswer = await request("/api/research/answer", {
    method: "POST",
    headers: {},
    body: JSON.stringify({ question: "Explain this topic", readTokens: ["not-a-token", "not-a-token"] })
  });
  assert.equal(blockedSourceAnswer.status, 401);

  const wrongLogin = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "wrong-password" })
  });
  assert.equal(wrongLogin.status, 401);

  const login = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-only-password-2026" })
  });
  assert.equal(login.status, 200);
  const cookieHeader = login.headers.get("set-cookie") || "";
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
  assert.match(login.headers.get("cache-control") || "", /no-store/i);
  cookie = cookieHeader.split(";")[0];
  assert.match(cookie, /^jarvis_session=/);
  const confirmedSession = await request("/api/session");
  assert.equal(confirmedSession.status, 200);
  assert.equal((await confirmedSession.json()).authenticated, true);

  const creatorCampaignResponse = await request("/api/creator/campaigns", {
    method: "POST",
    body: JSON.stringify({
      topic: "How a simple solar panel works",
      audience: "Curious beginners",
      language: "hinglish",
      sourceText: "Solar cells convert light into electrical energy. A panel combines many solar cells. An inverter changes direct current into alternating current.",
      brandKit: { brandName: "Solar Lab", accentColor: "#ff8800", backgroundColor: "#101820", textColor: "#ffffff" },
      includeTrendRadar: false
    })
  });
  assert.equal(creatorCampaignResponse.status, 201);
  const creatorCampaignPayload = await creatorCampaignResponse.json();
  assert.equal(creatorCampaignPayload.campaign.status, "draft");
  assert.equal(creatorCampaignPayload.campaign.shortVideo.scenes.length >= 2, true);
  assert.equal(creatorCampaignPayload.campaign.carousel.slides.length >= 4, true);
  assert.equal(creatorCampaignPayload.campaign.socialDrafts.length, 3);
  assert.equal(creatorCampaignPayload.campaign.trendRadar.status, "not-requested");
  assert.equal(creatorCampaignPayload.campaign.brandKit.brandName, "Solar Lab");
  assert.equal(creatorCampaignPayload.campaign.revision, 1);

  const reviseCreatorCampaign = await request("/api/creator/campaigns/" + creatorCampaignPayload.campaign.id, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Solar Lab · reviewed campaign",
      shortVideo: {
        hook: "How does sunlight become usable electricity?",
        scenes: creatorCampaignPayload.campaign.shortVideo.scenes.map((scene, index) =>
          index === 0 ? { ...scene, voiceover: "Let's see how sunlight becomes usable electricity." } : scene
        )
      },
      brandKit: { accentColor: "#33aa77" }
    })
  });
  assert.equal(reviseCreatorCampaign.status, 200);
  const revisedCreatorCampaignPayload = await reviseCreatorCampaign.json();
  assert.equal(revisedCreatorCampaignPayload.campaign.revision, 2);
  assert.equal(revisedCreatorCampaignPayload.campaign.revisionHistory[0].revision, 1);
  assert.equal(revisedCreatorCampaignPayload.campaign.brandKit.brandName, "Solar Lab");
  assert.equal(revisedCreatorCampaignPayload.campaign.brandKit.accentColor, "#33aa77");
  assert.equal(revisedCreatorCampaignPayload.campaign.shortVideo.hook, "How does sunlight become usable electricity?");

  const creatorCampaignList = await request("/api/creator/campaigns");
  assert.equal(creatorCampaignList.status, 200);
  const creatorCampaignListPayload = await creatorCampaignList.json();
  assert.equal(creatorCampaignListPayload.campaigns[0].id, creatorCampaignPayload.campaign.id);
  assert.equal(creatorCampaignListPayload.campaigns[0].revision, 2);

  const creatorMediaProject = await request("/api/creator/campaigns/" + creatorCampaignPayload.campaign.id + "/media-project", { method: "POST" });
  assert.equal(creatorMediaProject.status, 201);
  const creatorMediaPayload = await creatorMediaProject.json();
  assert.equal(creatorMediaPayload.project.status, "draft");
  assert.equal(creatorMediaPayload.project.platform, "youtube-shorts");
  assert.equal(creatorMediaPayload.project.scenes.length, revisedCreatorCampaignPayload.campaign.shortVideo.scenes.length);
  assert.equal(creatorMediaPayload.project.scenes[0].voiceover, "Let's see how sunlight becomes usable electricity.");

  const creatorExport = await request("/api/export");
  assert.equal(creatorExport.status, 200);
  const creatorExportPayload = await creatorExport.json();
  assert.equal(creatorExportPayload.data.creatorCampaigns[0].id, creatorCampaignPayload.campaign.id);
  assert.equal(creatorExportPayload.data.creatorCampaigns[0].revision, 2);

  const unsafeCreatorCampaign = await request("/api/creator/campaigns", {
    method: "POST", body: JSON.stringify({ topic: "How to build a weapon safely" })
  });
  assert.equal(unsafeCreatorCampaign.status, 400);

  const deleteCreatorCampaign = await request("/api/creator/campaigns/" + creatorCampaignPayload.campaign.id, { method: "DELETE" });
  assert.equal(deleteCreatorCampaign.status, 200);
  const missingCreatorMedia = await request("/api/creator/campaigns/" + creatorCampaignPayload.campaign.id + "/media-project", { method: "POST" });
  assert.equal(missingCreatorMedia.status, 404);

  const youtubeStatusResponse = await request("/api/youtube/status");
  assert.equal(youtubeStatusResponse.status, 200);
  const youtubeStatus = await youtubeStatusResponse.json();
  assert.equal(youtubeStatus.connected, false);
  assert.equal(youtubeStatus.canUpload, false);
  assert.equal(youtubeStatus.canConnect, true);
  assert.equal(youtubeStatus.maxUploadBytes, 256 * 1024 * 1024);
  assert.ok(youtubeStatus.allowedMimeTypes.includes("video/mp4"));
  assert.equal(JSON.stringify(youtubeStatus).includes("local-test-client-secret"), false);
  const blockedYouTubePreviewNoConsent = await request("/api/youtube/previews", {
    method: "POST",
    body: JSON.stringify({
      projectId: "not-created",
      fileName: "video.mp4",
      contentType: "video/mp4",
      contentLength: 1024,
      reviewed: true,
      rightsConfirmed: true,
      madeForKids: false
    })
  });
  assert.equal(blockedYouTubePreviewNoConsent.status, 409);
  assert.match((await blockedYouTubePreviewNoConsent.json()).error, /YouTube upload permission/i);

  const diagnosticsResponse = await request("/api/diagnostics");
  assert.equal(diagnosticsResponse.status, 200);
  const diagnostics = await diagnosticsResponse.json();
  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.status, "attention");
  assert.equal(diagnostics.version, "1.12.0-system-readiness");
  assert.ok(Number.isFinite(Date.parse(diagnostics.generatedAt)));
  assert.ok(diagnostics.warningCount > 0);
  assert.equal(diagnostics.errorCount, 0);

  const checkById = (id) => diagnostics.checks.find((item) => item.id === id);
  assert.equal(checkById("service").status, "ready");
  assert.equal(checkById("primary-storage").status, "warning");
  assert.equal(checkById("primary-storage").details.mode, "local-json-file");
  assert.equal(checkById("temporary-chat-storage").details.mode, "process-memory");
  assert.equal(checkById("ai-conversation").details.conversationEnabled, false);
  assert.equal(checkById("live-web-search").details.enabled, false);
  assert.equal(checkById("google-drive").details.canConnect, true);
  assert.equal(checkById("android-companion").details.pairedDevices, 0);
  assert.equal(diagnostics.inventory.tasks, 0);
  assert.equal(diagnostics.inventory.knowledgeItems, 0);

  const diagnosticsJson = JSON.stringify(diagnostics);
  assert.equal(diagnosticsJson.includes("test-only-password-2026"), false);
  assert.equal(diagnosticsJson.includes("local-test-client-secret"), false);
  assert.equal(diagnosticsJson.includes(Buffer.alloc(32, 11).toString("base64")), false);
  assert.equal(diagnosticsJson.includes("123456789:" + "A".repeat(32)), false);

  const disabledSourceAnswer = await request("/api/research/answer", {
    method: "POST",
    body: JSON.stringify({ question: "Explain this topic", readTokens: ["token-one", "token-two"] })
  });
  assert.equal(disabledSourceAnswer.status, 503);
  assert.match((await disabledSourceAnswer.json()).error, /full-page reading is disabled/i);

  const blockedActionHistory = await fetch(baseUrl + "/api/actions");
  assert.equal(blockedActionHistory.status, 401);
  const actionCapabilitiesResponse = await request("/api/actions/capabilities");
  assert.equal(actionCapabilitiesResponse.status, 200);
  const actionCapabilities = await actionCapabilitiesResponse.json();
  assert.equal(actionCapabilities.telegram.enabled, true);
  assert.deepEqual(actionCapabilities.telegram.allowedChatIds, ["123456789"]);
  assert.equal(actionCapabilities.googleDrive.canCreateDocs, false);

  const telegramPreview = await request("/api/actions", {
    method: "POST",
    body: JSON.stringify({
      type: "telegram_send_message",
      chatId: "123456789",
      text: "This is only a preview until exact confirmation."
    })
  });
  assert.equal(telegramPreview.status, 201);
  const telegramPreviewAction = (await telegramPreview.json()).action;
  assert.equal(telegramPreviewAction.status, "pending");
  assert.equal(telegramPreviewAction.confirmationPhrase, "SEND MESSAGE");

  const wrongActionConfirmation = await request("/api/actions/" + telegramPreviewAction.id + "/execute", {
    method: "POST",
    body: JSON.stringify({ confirmation: "SEND IT" })
  });
  assert.equal(wrongActionConfirmation.status, 400);
  assert.match((await wrongActionConfirmation.json()).error, /no external action was performed/i);

  const pendingActionList = await request("/api/actions");
  assert.equal(pendingActionList.status, 200);
  assert.equal((await pendingActionList.json()).actions[0].status, "pending");

  const cancelTelegramPreview = await request("/api/actions/" + telegramPreviewAction.id + "/cancel", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(cancelTelegramPreview.status, 200);
  assert.equal((await cancelTelegramPreview.json()).action.status, "cancelled");

  const blockedGoogleDocPreview = await request("/api/actions", {
    method: "POST",
    body: JSON.stringify({
      type: "google_drive_create_doc",
      title: "Test document",
      content: "This should not be created without Drive Docs consent."
    })
  });
  assert.equal(blockedGoogleDocPreview.status, 409);
  assert.match((await blockedGoogleDocPreview.json()).error, /drive.file permission/i);

  const integrationCatalogueResponse = await request("/api/integrations");
  assert.equal(integrationCatalogueResponse.status, 200);
  const integrationCatalogue = await integrationCatalogueResponse.json();
  assert.equal(integrationCatalogue.credentialStorage, "server-environment-or-encrypted-vault");
  assert.equal(integrationCatalogue.supportedOperations, "read-only");
  assert.equal(integrationCatalogue.providers.length, 4);
  assert.equal(integrationCatalogue.providers.find((item) => item.id === "github").configured, false);
  assert.equal(integrationCatalogue.providers.find((item) => item.id === "telegram").configured, true);
  assert.equal(integrationCatalogue.providers.find((item) => item.id === "elevenlabs").configured, false);
  assert.equal(integrationCatalogue.googleDriveOAuth.canConnect, true);
  assert.equal(integrationCatalogue.googleDriveOAuth.connected, false);
  assert.deepEqual(integrationCatalogue.googleDriveOAuth.requiredScopes, [
    "https://www.googleapis.com/auth/drive.metadata.readonly"
  ]);
  assert.equal(integrationCatalogue.providers.find((item) => item.id === "google_drive").oauthReady, true);
  assert.equal(integrationCatalogue.providers.find((item) => item.id === "google_drive").configured, true);
  assert.equal(integrationCatalogue.providers.find((item) => item.id === "google_drive").enabled, true);
  assert.equal(JSON.stringify(integrationCatalogue).includes("local-test-client-secret"), false);
  assert.equal(JSON.stringify(integrationCatalogue).includes("JARVIS_PASSWORD"), false);

  const startGoogleOAuth = await request("/api/integrations/google_drive/oauth/start", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(startGoogleOAuth.status, 200);
  const startGoogleOAuthPayload = await startGoogleOAuth.json();
  const googleLaunchUrl = new URL(startGoogleOAuthPayload.launchUrl);
  assert.equal(googleLaunchUrl.origin, "https://jarvis.example.test");
  assert.equal(googleLaunchUrl.pathname, "/api/integrations/google_drive/oauth/launch");
  assert.equal(startGoogleOAuth.headers.get("set-cookie")?.includes("jarvis_google_oauth=") || false, false);
  const googleBrowserLaunch = await request(googleLaunchUrl.pathname + googleLaunchUrl.search, {
    redirect: "manual",
    headers: {}
  });
  assert.equal(googleBrowserLaunch.status, 303);
  assert.equal(googleBrowserLaunch.headers.get("cache-control"), "no-store");
  assert.equal(googleBrowserLaunch.headers.get("referrer-policy"), "no-referrer");
  const replayedGoogleLaunch = await request(googleLaunchUrl.pathname + googleLaunchUrl.search, {
    redirect: "manual",
    headers: {}
  });
  assert.equal(replayedGoogleLaunch.status, 410);
  const googleAuthorizationUrl = new URL(googleBrowserLaunch.headers.get("location"));
  assert.equal(googleAuthorizationUrl.origin, "https://accounts.google.com");
  assert.equal(googleAuthorizationUrl.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.metadata.readonly");
  assert.equal(googleAuthorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.match(googleBrowserLaunch.headers.get("set-cookie") || "", /jarvis_google_oauth=/);

  const startGoogleDocsUpgrade = await request("/api/integrations/google_drive/oauth/start", {
    method: "POST", body: JSON.stringify({ capability: "create_docs" })
  });
  assert.equal(startGoogleDocsUpgrade.status, 200);
  const docsLaunchUrl = new URL((await startGoogleDocsUpgrade.json()).launchUrl);
  const docsBrowserLaunch = await request(docsLaunchUrl.pathname + docsLaunchUrl.search, {
    redirect: "manual",
    headers: {}
  });
  assert.equal(docsBrowserLaunch.status, 303);
  const docsUpgradeUrl = new URL(docsBrowserLaunch.headers.get("location"));
  assert.deepEqual(docsUpgradeUrl.searchParams.get("scope").split(" ").sort(), [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.metadata.readonly"
  ].sort());
  assert.equal(docsUpgradeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.match(docsBrowserLaunch.headers.get("set-cookie") || "", /HttpOnly/i);
  assert.match(docsBrowserLaunch.headers.get("set-cookie") || "", /SameSite=Lax/i);

  const startYoutubeOAuth = await request("/api/integrations/google_drive/oauth/start", {
    method: "POST",
    body: JSON.stringify({ capability: "youtube_upload" })
  });
  assert.equal(startYoutubeOAuth.status, 200);
  const youtubeLaunchUrl = new URL((await startYoutubeOAuth.json()).launchUrl);
  const youtubeBrowserLaunch = await request(youtubeLaunchUrl.pathname + youtubeLaunchUrl.search, {
    redirect: "manual",
    headers: {}
  });
  assert.equal(youtubeBrowserLaunch.status, 303);
  const youtubeAuthorizationUrl = new URL(youtubeBrowserLaunch.headers.get("location"));
  assert.deepEqual(youtubeAuthorizationUrl.searchParams.get("scope").split(" ").sort(), [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/drive.metadata.readonly"
  ].sort());
  assert.equal(youtubeAuthorizationUrl.searchParams.get("code_challenge_method"), "S256");

  const invalidGoogleCallback = await request("/api/integrations/google_drive/oauth/callback?state=not-a-real-state&code=not-a-real-code", {
    headers: {},
    redirect: "manual"
  });
  assert.equal(invalidGoogleCallback.status, 303);
  assert.match(invalidGoogleCallback.headers.get("location") || "", /integration=google_drive_error/);

  const disabledGithub = await request("/api/integrations/github/disable", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(disabledGithub.status, 200);
  assert.equal((await disabledGithub.json()).providers.find((item) => item.id === "github").enabled, false);

  const blockedIntegrationProbe = await request("/api/integrations/github/test", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(blockedIntegrationProbe.status, 409);

  const enabledGithub = await request("/api/integrations/github/enable", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(enabledGithub.status, 200);
  assert.equal((await enabledGithub.json()).providers.find((item) => item.id === "github").disabled, false);

  const integrationProbe = await request("/api/integrations/github/test", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert.equal(integrationProbe.status, 502);
  assert.match((await integrationProbe.json()).error, /JARVIS_GITHUB_TOKEN/);

  const crossOrigin = await request("/api/tasks", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
    body: JSON.stringify({ title: "Must be blocked" })
  });
  assert.equal(crossOrigin.status, 403);

  const createTask = await request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title: "Integration test task", description: "Check task flow" })
  });
  assert.equal(createTask.status, 201);
  const taskPayload = await createTask.json();
  assert.equal(taskPayload.task.title, "Integration test task");
  assert.equal(taskPayload.task.done, false);

  const completeTask = await request("/api/tasks/" + taskPayload.task.id, {
    method: "PATCH",
    body: JSON.stringify({ done: true })
  });
  assert.equal(completeTask.status, 200);
  assert.equal((await completeTask.json()).task.done, true);

  const createMemory = await request("/api/memories", {
    method: "POST",
    body: JSON.stringify({ content: "Prefer step-by-step explanations", category: "preference" })
  });
  assert.equal(createMemory.status, 201);
  const memoryPayload = await createMemory.json();
  assert.equal(memoryPayload.memory.category, "preference");
  assert.equal(typeof memoryPayload.memory.contentHash, "string");

  const duplicateMemory = await request("/api/memories", {
    method: "POST",
    body: JSON.stringify({ content: " prefer   step-by-step explanations ", category: "preference" })
  });
  assert.equal(duplicateMemory.status, 200);
  assert.equal((await duplicateMemory.json()).duplicate, true);

  const updateMemory = await request("/api/memories/" + memoryPayload.memory.id, {
    method: "PATCH",
    body: JSON.stringify({ content: "My goal is to practise algebra daily", category: "goal" })
  });
  assert.equal(updateMemory.status, 200);
  const updatedMemoryPayload = await updateMemory.json();
  assert.equal(updatedMemoryPayload.memory.category, "goal");
  assert.equal(updatedMemoryPayload.memory.content, "My goal is to practise algebra daily");
  assert.ok(updatedMemoryPayload.memory.updatedAt);

  const searchMemory = await request("/api/memories?q=algebra&category=goal");
  assert.equal(searchMemory.status, 200);
  const searchMemoryPayload = await searchMemory.json();
  assert.equal(searchMemoryPayload.count, 1);
  assert.equal(searchMemoryPayload.items[0].id, memoryPayload.memory.id);

  const savedResearch = await request("/api/research/saved", {
    method: "POST",
    body: JSON.stringify({
      query: "How does solar energy work?",
      answer: "Solar panels convert sunlight into electrical energy.",
      searchedAt: "2026-10-31T00:00:00.000Z",
      sources: [
        { title: "Official energy guide", url: "https://energy.example/solar" },
        { title: "Unsafe source", url: "javascript:alert(1)" }
      ]
    })
  });
  assert.equal(savedResearch.status, 201);
  const savedResearchPayload = await savedResearch.json();
  assert.equal(savedResearchPayload.item.sources.length, 1);

  const savedKnowledge = await request("/api/knowledge", {
    method: "POST",
    body: JSON.stringify({
      title: "Solar energy basics",
      content: "Photovoltaic cells convert sunlight into electricity.",
      category: "science",
      tags: ["solar", "energy"],
      sourceKind: "web-research",
      sourceQuery: "How do solar panels work?",
      sources: [{ title: "Official solar guide", url: "https://energy.example/solar", snippet: "Official search result snippet.", publishedAt: "2026-10-20", retrievedAt: "2026-10-31T10:00:00.000Z" }],
      citations: [{ claim: "Photovoltaic cells convert sunlight into electricity.", sourceUrls: ["https://energy.example/solar"] }]
    })
  });
  assert.equal(savedKnowledge.status, 201);
  const knowledgePayload = await savedKnowledge.json();
  assert.equal(knowledgePayload.item.reviewStatus, "unreviewed");
  assert.equal(knowledgePayload.item.sources.length, 1);
  assert.equal(knowledgePayload.item.sources[0].snippet, "Official search result snippet.");
  assert.equal(knowledgePayload.item.sources[0].publishedAt, "2026-10-20T00:00:00.000Z");
  assert.equal(knowledgePayload.item.sources[0].retrievedAt, "2026-10-31T10:00:00.000Z");
  assert.ok(knowledgePayload.item.capturedAt);

  const duplicateKnowledge = await request("/api/knowledge", {
    method: "POST",
    body: JSON.stringify({
      title: " solar   energy basics ",
      content: "PHOTOVOLTAIC cells convert sunlight into electricity. ",
      category: "science",
      sourceKind: "web-research",
      sources: [
        { url: "https://energy.example/solar#overview" },
        { title: "University solar study", url: "https://university.example/solar", publishedAt: "2026-10-22" }
      ]
    })
  });
  assert.equal(duplicateKnowledge.status, 200);
  const duplicatePayload = await duplicateKnowledge.json();
  assert.equal(duplicatePayload.duplicate, true);
  assert.equal(duplicatePayload.merged, true);
  assert.equal(duplicatePayload.item.id, knowledgePayload.item.id);
  assert.equal(duplicatePayload.item.reviewStatus, "unreviewed");
  assert.equal(duplicatePayload.item.sources.length, 2);
  assert.equal(duplicatePayload.item.sources[1].url, "https://university.example/solar");

  const knowledgeSearch = await request("/api/knowledge?q=photovoltaic");
  assert.equal(knowledgeSearch.status, 200);
  const knowledgeSearchPayload = await knowledgeSearch.json();
  assert.equal(knowledgeSearchPayload.total, 1);
  assert.equal(knowledgeSearchPayload.items[0].id, knowledgePayload.item.id);
  assert.equal(knowledgeSearchPayload.reviewSummary.total, 1);
  assert.equal(knowledgeSearchPayload.reviewSummary.unreviewed, 1);

  const trustedKnowledgeSearch = await request("/api/knowledge?review=trusted");
  assert.equal(trustedKnowledgeSearch.status, 200);
  assert.equal((await trustedKnowledgeSearch.json()).count, 0);

  const unreviewedKnowledgeSearch = await request("/api/knowledge?review=unreviewed");
  assert.equal((await unreviewedKnowledgeSearch.json()).count, 1);

  const invalidKnowledgeFilter = await request("/api/knowledge?review=unknown");
  assert.equal(invalidKnowledgeFilter.status, 400);

  const explicitLesson = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      message: "Learn: JEE average velocity | Average velocity equals total displacement divided by total time."
    })
  });
  assert.equal(explicitLesson.status, 200);
  const explicitLessonPayload = await explicitLesson.json();
  assert.equal(explicitLessonPayload.engine, "independent-learning");
  assert.equal(explicitLessonPayload.externalAI, false);
  assert.equal(explicitLessonPayload.learning.saved, true);
  assert.equal(explicitLessonPayload.learning.duplicate, false);

  const learningPreview = await request("/api/learning/preview", {
    method: "POST",
    body: JSON.stringify({ query: "Explain average velocity" })
  });
  assert.equal(learningPreview.status, 200);
  assert.match(learningPreview.headers.get("cache-control") || "", /no-store/i);
  const learningPreviewPayload = await learningPreview.json();
  assert.equal(learningPreviewPayload.counts.included, 1);
  assert.equal(learningPreviewPayload.contextItems[0].title, "JEE average velocity");
  assert.equal(learningPreviewPayload.policy.externalAIRequired, false);
  assert.equal(learningPreviewPayload.policy.modelTraining, false);

  const offlineLearnedAnswer = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "Explain average velocity using my saved lesson" })
  });
  assert.equal(offlineLearnedAnswer.status, 200);
  const offlineLearnedPayload = await offlineLearnedAnswer.json();
  assert.equal(offlineLearnedPayload.externalAI, false);
  assert.match(offlineLearnedPayload.answer, /total displacement divided by total time/i);
  assert.match(offlineLearnedPayload.answer, /Saved Knowledge Library/i);

  const documentStorageStatus = await request("/api/knowledge/documents/status");
  assert.equal(documentStorageStatus.status, 200);
  const documentStorageInfo = await documentStorageStatus.json();
  assert.equal(documentStorageInfo.enabled, true);
  assert.equal(documentStorageInfo.storagePathConfigured, true);
  assert.equal(documentStorageInfo.durabilityVerified, false);
  assert.equal(documentStorageInfo.extraction.pdfTextExtraction, false);

  const documentBytes = Buffer.from("# Average speed\nAverage speed equals total distance divided by total time.", "utf8");
  const documentHeaders = {
    "content-type": "application/octet-stream",
    "x-jarvis-filename": encodeURIComponent("average-speed.md"),
    "x-jarvis-mime-type": "text/markdown",
    "x-jarvis-title": encodeURIComponent("Average speed notes"),
    "x-jarvis-collection": encodeURIComponent("JEE Physics"),
    "x-jarvis-tags": encodeURIComponent("motion, kinematics"),
    "x-jarvis-description": encodeURIComponent("Class notes on average speed.")
  };
  const documentUpload = await request("/api/knowledge/documents", {
    method: "POST",
    headers: documentHeaders,
    body: documentBytes
  });
  assert.equal(documentUpload.status, 201);
  const documentPayload = await documentUpload.json();
  assert.equal(documentPayload.item.reviewStatus, "unreviewed");
  assert.equal(documentPayload.item.indexingMode, "text");
  assert.equal(documentPayload.item.collection, "JEE Physics");
  assert.match(documentPayload.item.extractedText, /total distance divided by total time/i);
  assert.equal(Object.hasOwn(documentPayload.item, "storageKey"), false);

  const duplicateDocument = await request("/api/knowledge/documents", {
    method: "POST",
    headers: { ...documentHeaders, "x-jarvis-filename": encodeURIComponent("average-speed-copy.md") },
    body: documentBytes
  });
  assert.equal(duplicateDocument.status, 200);
  assert.equal((await duplicateDocument.json()).duplicate, true);

  const documentSearch = await request("/api/knowledge/documents?q=average%20speed&collection=JEE%20Physics");
  assert.equal(documentSearch.status, 200);
  const documentSearchPayload = await documentSearch.json();
  assert.equal(documentSearchPayload.count, 1);
  assert.equal(documentSearchPayload.items[0].id, documentPayload.item.id);

  const prematureDocumentApproval = await request("/api/knowledge/documents/" + documentPayload.item.id, {
    method: "PATCH",
    body: JSON.stringify({ reviewStatus: "user-reviewed" })
  });
  assert.equal(prematureDocumentApproval.status, 400);

  const approveDocument = await request("/api/knowledge/documents/" + documentPayload.item.id, {
    method: "PATCH",
    body: JSON.stringify({ reviewStatus: "user-reviewed", confirmReview: true })
  });
  assert.equal(approveDocument.status, 200);
  assert.equal((await approveDocument.json()).item.reviewStatus, "user-reviewed");

  const combinedLearningPreview = await request("/api/learning/preview", {
    method: "POST",
    body: JSON.stringify({ query: "average speed" })
  });
  assert.equal(combinedLearningPreview.status, 200);
  const combinedLearningPreviewPayload = await combinedLearningPreview.json();
  assert.equal(combinedLearningPreviewPayload.counts.documentsIncluded, 1);
  assert.equal(combinedLearningPreviewPayload.policy.maximumContextItems, 5);
  assert.ok(combinedLearningPreviewPayload.contextItems.some((item) => item.sourceKind === "user-document"));

  const documentAnswer = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "Explain average speed" })
  });
  assert.equal(documentAnswer.status, 200);
  const documentAnswerPayload = await documentAnswer.json();
  assert.equal(documentAnswerPayload.externalAI, false);
  assert.match(documentAnswerPayload.answer, /total distance divided by total time/i);
  assert.match(documentAnswerPayload.answer, /Average speed notes/i);

  const documentDownload = await request("/api/knowledge/documents/" + documentPayload.item.id + "/download");
  assert.equal(documentDownload.status, 200);
  assert.match(documentDownload.headers.get("content-disposition") || "", /attachment/i);
  assert.equal(documentDownload.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await documentDownload.arrayBuffer()), documentBytes);

  await fs.writeFile(path.join(tempDir, "documents", documentPayload.item.id + ".md"), "tampered file bytes");
  const tamperedDownload = await request("/api/knowledge/documents/" + documentPayload.item.id + "/download");
  assert.equal(tamperedDownload.status, 409);

  const editReviewedDocument = await request("/api/knowledge/documents/" + documentPayload.item.id, {
    method: "PATCH",
    body: JSON.stringify({ description: "Updated graph explanation." })
  });
  assert.equal(editReviewedDocument.status, 200);
  assert.equal((await editReviewedDocument.json()).item.reviewStatus, "unreviewed");

  const spoofedDocument = await request("/api/knowledge/documents", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-jarvis-filename": "photo.png",
      "x-jarvis-mime-type": "image/png"
    },
    body: Buffer.from("not a PNG")
  });
  assert.equal(spoofedDocument.status, 400);

  const deleteDocument = await request("/api/knowledge/documents/" + documentPayload.item.id, { method: "DELETE" });
  assert.equal(deleteDocument.status, 200);
  const deletedDocumentDownload = await request("/api/knowledge/documents/" + documentPayload.item.id + "/download");
  assert.equal(deletedDocumentDownload.status, 404);

  const combinedSearch = await request("/api/search?q=photovoltaic");
  assert.equal(combinedSearch.status, 200);
  const combinedPayload = await combinedSearch.json();
  assert.equal(combinedPayload.externalSearch, false);
  assert.ok(combinedPayload.results.some((item) => item.source === "saved-knowledge"));

  const markKnowledgeReviewed = await request("/api/knowledge/" + knowledgePayload.item.id, {
    method: "PATCH",
    body: JSON.stringify({ reviewStatus: "user-reviewed" })
  });
  assert.equal(markKnowledgeReviewed.status, 200);
  assert.equal((await markKnowledgeReviewed.json()).item.reviewStatus, "user-reviewed");
  const reviewedSearch = await request("/api/knowledge?q=photovoltaic");
  const reviewedSearchPayload = await reviewedSearch.json();
  assert.ok(reviewedSearchPayload.items[0].reviewedAt);

  const trustedAfterReview = await request("/api/knowledge?review=trusted");
  const trustedAfterReviewPayload = await trustedAfterReview.json();
  assert.equal(trustedAfterReviewPayload.count, 2);
  assert.equal(trustedAfterReviewPayload.reviewSummary.trusted, 2);

  const rejectKnowledge = await request("/api/knowledge/" + knowledgePayload.item.id, {
    method: "PATCH",
    body: JSON.stringify({ reviewStatus: "rejected", reviewNote: "The source did not support the summary." })
  });
  assert.equal(rejectKnowledge.status, 200);
  const rejectedPayload = await rejectKnowledge.json();
  assert.equal(rejectedPayload.item.reviewStatus, "rejected");
  assert.equal(rejectedPayload.item.reviewNote, "The source did not support the summary.");

  const rejectedFilter = await request("/api/knowledge?review=rejected");
  assert.equal((await rejectedFilter.json()).count, 1);

  const reopenKnowledge = await request("/api/knowledge/" + knowledgePayload.item.id, {
    method: "PATCH",
    body: JSON.stringify({ reviewStatus: "unreviewed" })
  });
  assert.equal(reopenKnowledge.status, 200);
  assert.equal((await reopenKnowledge.json()).item.reviewStatus, "unreviewed");

  const invalidKnowledgeReview = await request("/api/knowledge/" + knowledgePayload.item.id, {
    method: "PATCH",
    body: JSON.stringify({ reviewStatus: "untrusted" })
  });
  assert.equal(invalidKnowledgeReview.status, 400);

  const currentState = await request("/api/state");
  assert.equal(currentState.status, 200);
  const snapshot = await currentState.json();
  assert.equal(snapshot.tasks.some((item) => item.id === taskPayload.task.id), true);
  assert.equal(snapshot.memories.some((item) => item.id === memoryPayload.memory.id), true);
  assert.equal(snapshot.research.some((item) => item.id === savedResearchPayload.item.id), true);

  const deleteSavedResearch = await request("/api/research/saved/" + savedResearchPayload.item.id, { method: "DELETE" });
  assert.equal(deleteSavedResearch.status, 200);

  const deleteKnowledge = await request("/api/knowledge/" + knowledgePayload.item.id, { method: "DELETE" });
  assert.equal(deleteKnowledge.status, 200);

  const deleteMemory = await request("/api/memories/" + memoryPayload.memory.id, { method: "DELETE" });
  assert.equal(deleteMemory.status, 200);
  const deleteTask = await request("/api/tasks/" + taskPayload.task.id, { method: "DELETE" });
  assert.equal(deleteTask.status, 200);

  const createWorkflow = await request("/api/workflows", {
    method: "POST",
    body: JSON.stringify({
      name: "JEE study preparation",
      description: "Prepare a safe local study session and review it before finishing.",
      steps: [
        { type: "create_task", title: "Revise Newton's laws", description: "Review the three laws and solve two examples." },
        { type: "save_memory", title: "Save chemistry learning preference", content: "I prefer short worked examples for chemistry revision.", category: "preference" },
        { type: "search_knowledge", title: "Find mole concept notes", query: "mole concept" },
        { type: "review_checkpoint", title: "Review study plan", message: "Check the task, memory and search results before continuing." },
        { type: "draft_text", title: "Prepare revision checklist", content: "1. Recall the laws.\n2. Solve two examples.\n3. Review your mistakes." }
      ]
    })
  });
  assert.equal(createWorkflow.status, 201);
  const workflowPayload = await createWorkflow.json();
  assert.equal(workflowPayload.workflow.status, "draft");
  assert.equal(workflowPayload.workflow.steps.length, 5);

  const runUnapprovedWorkflow = await request("/api/workflows/" + workflowPayload.workflow.id + "/run", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(runUnapprovedWorkflow.status, 409);

  const invalidWorkflow = await request("/api/workflows", {
    method: "POST",
    body: JSON.stringify({
      name: "Unsupported automation",
      steps: [{ type: "run_shell", title: "Run a system command", command: "echo unsafe" }]
    })
  });
  assert.equal(invalidWorkflow.status, 400);

  const validateWorkflow = await request("/api/workflows/" + workflowPayload.workflow.id + "/validate", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(validateWorkflow.status, 200);
  assert.equal((await validateWorkflow.json()).validation.passed, true);

  const approveWorkflow = await request("/api/workflows/" + workflowPayload.workflow.id + "/approve", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(approveWorkflow.status, 200);
  assert.equal((await approveWorkflow.json()).workflow.status, "approved");

  const runWorkflow = await request("/api/workflows/" + workflowPayload.workflow.id + "/run", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(runWorkflow.status, 201);
  const runPayload = await runWorkflow.json();
  assert.equal(runPayload.run.status, "waiting_review");
  assert.equal(runPayload.run.steps[0].status, "completed");
  assert.equal(runPayload.run.steps[1].status, "completed");
  assert.equal(runPayload.run.steps[2].status, "completed");
  assert.equal(runPayload.run.steps[3].status, "waiting_review");
  assert.ok(runPayload.run.steps[0].result.taskId);
  assert.ok(runPayload.run.steps[1].result.memoryId);

  const duplicateRun = await request("/api/workflows/" + workflowPayload.workflow.id + "/run", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(duplicateRun.status, 409);

  const continueRun = await request("/api/workflow-runs/" + runPayload.run.id + "/continue", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(continueRun.status, 200);
  const continuedPayload = await continueRun.json();
  assert.equal(continuedPayload.run.status, "completed");
  assert.equal(continuedPayload.run.steps[3].status, "completed");
  assert.match(continuedPayload.run.steps[4].result.draft, /Recall the laws/);

  const workflowState = await request("/api/workflows");
  assert.equal(workflowState.status, 200);
  const workflowStatePayload = await workflowState.json();
  assert.ok(workflowStatePayload.workflows.some((item) => item.id === workflowPayload.workflow.id));
  assert.ok(workflowStatePayload.runs.some((item) => item.id === runPayload.run.id));

  const cancelledWorkflow = await request("/api/workflows", {
    method: "POST",
    body: JSON.stringify({
      name: "Review and stop test",
      steps: [
        { type: "create_task", title: "Prepare a simple task", description: "This task can be stopped after review." },
        { type: "review_checkpoint", title: "Wait for review", message: "Review before continuing." },
        { type: "draft_text", title: "Prepare draft", content: "This draft should not be created after stopping the workflow." }
      ]
    })
  });
  assert.equal(cancelledWorkflow.status, 201);
  const cancelledDraft = await cancelledWorkflow.json();
  const cancelledValidation = await request("/api/workflows/" + cancelledDraft.workflow.id + "/validate", {
    method: "POST", body: JSON.stringify({})
  });
  const cancelledValidated = await cancelledValidation.json();
  const cancelledApproval = await request("/api/workflows/" + cancelledDraft.workflow.id + "/approve", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(cancelledApproval.status, 200);
  const waitingRunResponse = await request("/api/workflows/" + cancelledDraft.workflow.id + "/run", {
    method: "POST", body: JSON.stringify({})
  });
  const waitingRun = await waitingRunResponse.json();
  assert.equal(waitingRun.run.status, "waiting_review");
  const waitingRecoveryResponse = await request("/api/workflow-runs/" + waitingRun.run.id + "/recovery");
  assert.equal(waitingRecoveryResponse.status, 200);
  const waitingRecovery = (await waitingRecoveryResponse.json()).recovery;
  assert.equal(waitingRecovery.canContinue, true);
  assert.equal(waitingRecovery.automaticRecovery, false);
  const stopRunResponse = await request("/api/workflow-runs/" + waitingRun.run.id + "/stop", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(stopRunResponse.status, 200);
  const stoppedRun = await stopRunResponse.json();
  assert.equal(stoppedRun.run.status, "cancelled");
  assert.equal(stoppedRun.run.steps[2].status, "skipped");

  const createIntegratedWorkflow = await request("/api/workflows", {
    method: "POST",
    body: JSON.stringify({
      name: "Read GitHub repositories",
      steps: [{ type: "github_list_repositories", title: "List my repositories" }]
    })
  });
  assert.equal(createIntegratedWorkflow.status, 201);
  const integratedDraft = await createIntegratedWorkflow.json();
  const integratedValidation = await request("/api/workflows/" + integratedDraft.workflow.id + "/validate", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal((await integratedValidation.json()).validation.passed, true);
  const integratedApproval = await request("/api/workflows/" + integratedDraft.workflow.id + "/approve", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(integratedApproval.status, 200);
  const disableBeforeRun = await request("/api/integrations/github/disable", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(disableBeforeRun.status, 200);
  const blockedIntegrationRun = await request("/api/workflows/" + integratedDraft.workflow.id + "/run", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(blockedIntegrationRun.status, 201);
  const blockedRunPayload = await blockedIntegrationRun.json();
  assert.equal(blockedRunPayload.run.status, "failed");
  assert.equal(blockedRunPayload.run.failure.code, "configuration_missing");
  assert.equal(blockedRunPayload.run.failure.retryable, false);
  assert.match(blockedRunPayload.run.steps[0].result.error, /not configured or is disabled/i);
  const autoHealCapturedFailure = await request("/api/auto-heal");
  assert.equal(autoHealCapturedFailure.status, 200);
  const autoHealCapturedState = await autoHealCapturedFailure.json();
  const capturedIncident = autoHealCapturedState.state.incidents.find((item) => item.runId === blockedRunPayload.run.id);
  assert.ok(capturedIncident);
  assert.equal(capturedIncident.failureCode, "configuration_missing");
  assert.equal(autoHealCapturedState.status.automaticRepair, false);
  assert.equal(autoHealCapturedState.status.automaticRetry, false);
  assert.equal(autoHealCapturedState.status.sourceModification, false);
  assert.equal(autoHealCapturedState.status.externalActions, false);
  assert.equal(autoHealCapturedState.status.config.workflowStepTimeoutMs, 60_000);
  assert.equal(autoHealCapturedState.status.config.maxManualRetryAttempts, 3);
  const unsupportedRepairProposal = await request("/api/auto-heal/incidents/" + capturedIncident.id + "/propose", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(unsupportedRepairProposal.status, 409);
  assert.match((await unsupportedRepairProposal.json()).error, /no bounded repair proposal/i);
  const unknownRepairApproval = await request("/api/auto-heal/proposals/not-a-proposal/approve", {
    method: "POST", body: JSON.stringify({ expectedRevision: autoHealCapturedState.state.revision, confirm: true })
  });
  assert.equal(unknownRepairApproval.status, 409);
  const autoHealReadAfterRejectedProposal = await request("/api/auto-heal");
  assert.equal((await autoHealReadAfterRejectedProposal.json()).state.revision, autoHealCapturedState.state.revision);

  const manualAutoHealScan = await request("/api/auto-heal/inspect", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(manualAutoHealScan.status, 200);
  const scannedAutoHealState = await manualAutoHealScan.json();
  assert.equal(scannedAutoHealState.state.incidents.filter((item) => item.runId === blockedRunPayload.run.id).length, 1);

  const blockedRecovery = await request("/api/workflow-runs/" + blockedRunPayload.run.id + "/recovery");
  assert.equal(blockedRecovery.status, 200);
  const blockedRecoveryPayload = await blockedRecovery.json();
  assert.equal(blockedRecoveryPayload.recovery.canRetry, false);
  assert.equal(blockedRecoveryPayload.recovery.automaticRecovery, false);
  assert.equal(blockedRecoveryPayload.recovery.failure.code, "configuration_missing");
  assert.equal((await request("/api/workflow-runs/not-a-real-run/recovery")).status, 404);
  const blockedRetry = await request("/api/workflow-runs/" + blockedRunPayload.run.id + "/retry", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(blockedRetry.status, 409);

  const disableGoogleOAuth = await request("/api/integrations/google_drive/disable", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(disableGoogleOAuth.status, 200);
  const blockedOAuthStart = await request("/api/integrations/google_drive/oauth/start", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(blockedOAuthStart.status, 409);
  const enableGoogleOAuth = await request("/api/integrations/google_drive/enable", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(enableGoogleOAuth.status, 200);

  const enableBeforeRun = await request("/api/integrations/github/enable", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(enableBeforeRun.status, 200);
  const integratedRunResponse = await request("/api/workflows/" + integratedDraft.workflow.id + "/run", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(integratedRunResponse.status, 201);
  const integratedRun = await integratedRunResponse.json();
  assert.equal(integratedRun.run.status, "failed");
  assert.equal(integratedRun.run.failure.code, "configuration_missing");
  assert.equal(integratedRun.run.steps[0].result.failure.retryable, false);
  assert.equal(integratedRun.run.steps[0].attempts, 1);
  assert.equal(JSON.stringify(integratedRun).includes("demo-github-value"), false);
  assert.equal(JSON.stringify(integratedRun).includes("JARVIS_GITHUB_TOKEN"), false);

  const retryOnce = await request("/api/workflow-runs/" + integratedRun.run.id + "/retry", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(retryOnce.status, 409);
  const nonRetryableRecovery = await request("/api/workflow-runs/" + integratedRun.run.id + "/recovery");
  assert.equal((await nonRetryableRecovery.json()).recovery.canRetry, false);

  const createFeedback = await request("/api/feedback", {
    method: "POST",
    body: JSON.stringify({
      prompt: "This user prompt must never be persisted as feedback.",
      rating: "down",
      category: "clarity",
      suggestion: "Explain the main idea first, then show one small worked example.",
      engine: "gemini-conversation",
      note: "Legacy clients may send a note, but it is not stored."
    })
  });
  assert.equal(createFeedback.status, 201);
  const feedbackPayload = await createFeedback.json();
  assert.equal(feedbackPayload.feedback.rating, "down");
  assert.equal(feedbackPayload.feedback.category, "clarity");
  assert.match(feedbackPayload.feedback.suggestion, /worked example/);
  assert.equal(Object.hasOwn(feedbackPayload.feedback, "prompt"), false);
  assert.equal(Object.hasOwn(feedbackPayload.feedback, "note"), false);

  const experienceOverview = await request("/api/experience");
  assert.equal(experienceOverview.status, 200);
  const experiencePayload = await experienceOverview.json();
  assert.equal(experiencePayload.summary.needsWork, 1);
  assert.equal(experiencePayload.summary.pendingSuggestions, 1);

  const promoteFeedback = await request("/api/feedback/" + feedbackPayload.feedback.id + "/approve", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert.equal(promoteFeedback.status, 201);
  const promotedPayload = await promoteFeedback.json();
  assert.equal(promotedPayload.preference.active, true);
  assert.equal(promotedPayload.preference.category, "clarity");

  const pausePreference = await request("/api/experience/preferences/" + promotedPayload.preference.id, {
    method: "PATCH",
    body: JSON.stringify({ active: false })
  });
  assert.equal(pausePreference.status, 200);
  assert.equal((await pausePreference.json()).preference.active, false);

  const enablePreference = await request("/api/experience/preferences/" + promotedPayload.preference.id, {
    method: "PATCH",
    body: JSON.stringify({ active: true })
  });
  assert.equal((await enablePreference.json()).preference.active, true);

  const createSkill = await request("/api/skills", {
    method: "POST",
    body: JSON.stringify({
      name: "Simple Hinglish",
      instructions: "Explain matching questions in simple Hinglish, show the key steps, and check the result.",
      triggers: ["explain in simple Hinglish", "simple Hinglish question"],
      testCases: [
        { input: "Please explain in simple Hinglish", shouldMatch: true },
        { input: "What is the weather?", shouldMatch: false }
      ]
    })
  });
  assert.equal(createSkill.status, 201);
  const skillPayload = await createSkill.json();
  assert.equal(skillPayload.skill.name, "Simple Hinglish");
  assert.equal(skillPayload.skill.status, "draft");
  assert.equal(skillPayload.skill.activeVersion, null);

  const validateSkill = await request("/api/skills/" + skillPayload.skill.id + "/validate", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(validateSkill.status, 200);
  assert.equal((await validateSkill.json()).validation.passed, true);

  const approveSkill = await request("/api/skills/" + skillPayload.skill.id + "/approve", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(approveSkill.status, 200);
  const approvedSkill = await approveSkill.json();
  assert.equal(approvedSkill.skill.status, "active");
  assert.equal(approvedSkill.skill.activeVersion, 1);
  assert.deepEqual(approvedSkill.skill.applicationIds, ["*"]);

  const registryResponse = await request("/api/skills");
  assert.equal(registryResponse.status, 200);
  const registryPayload = await registryResponse.json();
  assert.ok(registryPayload.applicationCatalog.some((item) => item.id === "web-dashboard"));
  assert.ok(registryPayload.applicationCatalog.some((item) => item.id === "android-companion"));
  assert.equal(registryPayload.limits.applicationIds, 12);

  const globalPreview = await request("/api/skills/preview", {
    method: "POST",
    body: JSON.stringify({ message: "Please explain in simple Hinglish", applicationId: "android-companion" })
  });
  assert.equal(globalPreview.status, 200);
  const globalPreviewPayload = await globalPreview.json();
  assert.equal(globalPreviewPayload.applicationId, "android-companion");
  assert.equal(globalPreviewPayload.mode, "static-trigger-preview");
  assert.ok(globalPreviewPayload.matches.some((item) => item.id === skillPayload.skill.id));

  const scopedSkillResponse = await request("/api/skills", {
    method: "POST",
    body: JSON.stringify({
      name: "Android-only skill",
      instructions: "Explain Android companion questions clearly, state assumptions, and keep answers accurate.",
      applicationIds: ["android-companion"],
      triggers: ["explain Android companion"],
      testCases: [
        { input: "Please explain Android companion", shouldMatch: true },
        { input: "What is the weather today?", shouldMatch: false }
      ]
    })
  });
  assert.equal(scopedSkillResponse.status, 201);
  const scopedSkill = (await scopedSkillResponse.json()).skill;
  assert.deepEqual(scopedSkill.applicationIds, ["android-companion"]);
  const scopedValidation = await request("/api/skills/" + scopedSkill.id + "/validate", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal((await scopedValidation.json()).validation.passed, true);
  const scopedApproval = await request("/api/skills/" + scopedSkill.id + "/approve", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(scopedApproval.status, 200);

  const dashboardPreview = await request("/api/skills/preview", {
    method: "POST",
    body: JSON.stringify({ message: "Please explain Android companion", applicationId: "web-dashboard" })
  });
  assert.equal((await dashboardPreview.json()).matches.some((item) => item.id === scopedSkill.id), false);
  const androidPreview = await request("/api/skills/preview", {
    method: "POST",
    body: JSON.stringify({ message: "Please explain Android companion", applicationId: "android-companion" })
  });
  assert.equal((await androidPreview.json()).matches.some((item) => item.id === scopedSkill.id), true);
  const invalidPreview = await request("/api/skills/preview", {
    method: "POST",
    body: JSON.stringify({ message: "Please explain Android companion", applicationId: "com.example/app" })
  });
  assert.equal(invalidPreview.status, 400);

  const skillContextMatched = await request("/api/skills");
  assert.equal(skillContextMatched.status, 200);
  assert.ok((await skillContextMatched.json()).skills.some((item) => item.id === skillPayload.skill.id));

  const updateSkill = await request("/api/skills/" + skillPayload.skill.id, {
    method: "PATCH",
    body: JSON.stringify({
      name: "Simple Hinglish Plus",
      instructions: "Explain matching questions in simple Hinglish, show each step, check units, and verify the result.",
      triggers: ["explain in simple Hinglish", "simple Hinglish question", "check units"],
      testCases: [
        { input: "Please explain in simple Hinglish", shouldMatch: true },
        { input: "What is the weather?", shouldMatch: false }
      ]
    })
  });
  assert.equal(updateSkill.status, 200);
  const updatedSkill = await updateSkill.json();
  assert.equal(updatedSkill.skill.currentVersion, 2);
  assert.equal(updatedSkill.skill.activeVersion, 1);
  assert.equal(updatedSkill.skill.status, "update-pending");

  const untestedApprove = await request("/api/skills/" + skillPayload.skill.id + "/approve", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(untestedApprove.status, 409);

  const validateUpdatedSkill = await request("/api/skills/" + skillPayload.skill.id + "/validate", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal((await validateUpdatedSkill.json()).validation.passed, true);

  const approveUpdatedSkill = await request("/api/skills/" + skillPayload.skill.id + "/approve", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(approveUpdatedSkill.status, 200);
  assert.equal((await approveUpdatedSkill.json()).skill.activeVersion, 2);

  const createCrucibleProgram = await request("/api/skill-crucible/programs", {
    method: "POST",
    body: JSON.stringify({
      skillId: skillPayload.skill.id,
      name: "Hinglish explanation formatter",
      program: {
        steps: [
          { op: "normalize_input" },
          { op: "extract_keywords", max: 5 },
          { op: "match_any", phrases: ["explain in simple Hinglish"] },
          { op: "format_output", template: "Matched: {matched}. Keywords: {keywords}. Request: {input}" }
        ]
      },
      testCases: [
        { input: "Please explain in simple Hinglish", expectedMatched: true },
        { input: "Tell me the weather today", expectedMatched: false }
      ]
    })
  });
  assert.equal(createCrucibleProgram.status, 201);
  const crucibleDraft = (await createCrucibleProgram.json()).program;
  assert.equal(crucibleDraft.status, "draft");
  assert.equal(crucibleDraft.activeVersion, null);

  const testCrucibleProgram = await request("/api/skill-crucible/programs/" + crucibleDraft.id + "/test", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(testCrucibleProgram.status, 200);
  assert.equal((await testCrucibleProgram.json()).validation.passed, true);

  const approveCrucibleProgram = await request("/api/skill-crucible/programs/" + crucibleDraft.id + "/approve", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(approveCrucibleProgram.status, 200);
  assert.equal((await approveCrucibleProgram.json()).program.status, "approved");

  const runCrucibleProgram = await request("/api/skill-crucible/programs/" + crucibleDraft.id + "/run", {
    method: "POST",
    body: JSON.stringify({ input: "Please explain in simple Hinglish with examples", applicationId: "web-dashboard" })
  });
  assert.equal(runCrucibleProgram.status, 200);
  const crucibleResult = (await runCrucibleProgram.json()).result;
  assert.equal(crucibleResult.sideEffects, false);
  assert.equal(crucibleResult.executionMode, "isolated-allow-listed-dsl");
  assert.match(crucibleResult.output, /Matched: yes/);

  const nonMatchingCrucibleRun = await request("/api/skill-crucible/programs/" + crucibleDraft.id + "/run", {
    method: "POST",
    body: JSON.stringify({ input: "Tell me the weather", applicationId: "web-dashboard" })
  });
  assert.equal(nonMatchingCrucibleRun.status, 409);

  const pauseCrucibleProgram = await request("/api/skill-crucible/programs/" + crucibleDraft.id + "/pause", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(pauseCrucibleProgram.status, 200);
  assert.equal((await pauseCrucibleProgram.json()).program.status, "paused");

  const crucibleList = await request("/api/skill-crucible");
  assert.equal(crucibleList.status, 200);
  assert.ok((await crucibleList.json()).programs.some((item) => item.id === crucibleDraft.id));

  const versions = await request("/api/skills/" + skillPayload.skill.id + "/versions");
  assert.equal(versions.status, 200);
  assert.equal((await versions.json()).versions.length, 2);

  const pausedSkill = await request("/api/skills/" + skillPayload.skill.id + "/pause", {
    method: "POST", body: JSON.stringify({})
  });
  assert.equal(pausedSkill.status, 200);
  assert.equal((await pausedSkill.json()).skill.status, "paused");

  const learningState = await request("/api/state");
  const learningSnapshot = await learningState.json();
  assert.equal(learningSnapshot.feedback.some((item) => item.id === feedbackPayload.feedback.id), true);
  assert.equal(learningSnapshot.skills.some((item) => item.id === skillPayload.skill.id), true);

  assert.equal((await request("/api/feedback/" + feedbackPayload.feedback.id, { method: "DELETE" })).status, 200);
  assert.equal((await request("/api/experience/preferences/" + promotedPayload.preference.id, { method: "DELETE" })).status, 200);
  assert.equal((await request("/api/skills/" + scopedSkill.id, { method: "DELETE" })).status, 200);
  assert.equal((await request("/api/skills/" + skillPayload.skill.id, { method: "DELETE" })).status, 200);

  const disabledWebResearch = await request("/api/research", {
    method: "POST",
    body: JSON.stringify({ query: "What changed in the latest science research?" })
  });
  assert.equal(disabledWebResearch.status, 503);

  const localSearch = await request("/api/search?q=mole%20concept");
  assert.equal(localSearch.status, 200);
  const localSearchPayload = await localSearch.json();
  assert.equal(localSearchPayload.externalSearch, false);
  assert.ok(localSearchPayload.results.some((item) => item.title === "Mole concept"));

  const invalidApplicationChat = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "What is 2 + 2?", applicationId: "com.example/app" })
  });
  assert.equal(invalidApplicationChat.status, 400);
  const spoofedApplicationChat = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "What is 2 + 2?", applicationId: "android-companion" })
  });
  assert.equal(spoofedApplicationChat.status, 400);

  const localChat = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "What is 2 + 2?", applicationId: "web-dashboard" })
  });
  assert.equal(localChat.status, 200);
  const chatPayload = await localChat.json();
  assert.match(chatPayload.answer, /4/);
  assert.equal(chatPayload.engine, "built-in-offline");
  assert.equal(chatPayload.externalAI, false);

  const memoryCommand = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "Remember that I prefer short Hinglish explanations." })
  });
  assert.equal(memoryCommand.status, 200);
  assert.match((await memoryCommand.json()).answer, /remember this/i);

  const blockedMemoryCommand = await request("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: "Remember that my API key is do-not-save." })
  });
  assert.equal(blockedMemoryCommand.status, 200);
  assert.match((await blockedMemoryCommand.json()).answer, /won't save/i);

  const sessionState = await request("/api/state");
  const sessionSnapshot = await sessionState.json();
  assert.ok(sessionSnapshot.chats.some((item) => item.content === "What is 2 + 2?"));
  assert.ok(sessionSnapshot.memories.some((item) => item.content === "I prefer short Hinglish explanations"));

  const exportResponse = await request("/api/export");
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get("content-disposition") || "", /jarvis-personal-data\.json/i);
  assert.equal(exportResponse.headers.get("cache-control"), "no-store");
  const exportPayload = await exportResponse.json();
  assert.equal(exportPayload.format, "jarvis-personal-data");
  assert.ok(exportPayload.data.memories.some((item) => item.content === "I prefer short Hinglish explanations"));
  assert.ok(Array.isArray(exportPayload.data.knowledge));
  assert.ok(Array.isArray(exportPayload.data.research));
  assert.ok(Array.isArray(exportPayload.data.tasks));
  assert.ok(Array.isArray(exportPayload.data.skills));
  assert.ok(Array.isArray(exportPayload.data.feedback));
  assert.ok(Array.isArray(exportPayload.data.experiencePreferences));
  assert.ok(Array.isArray(exportPayload.data.workflows));
  assert.ok(Array.isArray(exportPayload.data.workflowRuns));
  assert.ok(Array.isArray(exportPayload.data.disabledIntegrations));
  assert.ok(Array.isArray(exportPayload.data.externalActions));
  assert.ok(Array.isArray(exportPayload.data.youtubePublications));
  assert.equal(Object.hasOwn(exportPayload.data, "oauthConnections"), false);
  assert.equal(JSON.stringify(exportPayload).includes("encryptedRefreshToken"), false);
  assert.equal(Object.hasOwn(exportPayload.data, "integrations"), false);
  assert.equal(Object.hasOwn(exportPayload.data, "credentials"), false);
  assert.equal(Object.hasOwn(exportPayload.data, "chats"), false);
  assert.equal(Object.hasOwn(exportPayload.data, "devices"), false);
  assert.ok(exportPayload.excluded.includes("temporary conversation history"));
  assert.equal(JSON.stringify(exportPayload).includes("test-only-password-2026"), false);

  const persistedState = await fs.readFile(path.join(tempDir, "state.json"), "utf8");
  assert.equal(persistedState.includes("What is 2 + 2?"), false);
  assert.equal(persistedState.includes("Remember that I prefer short Hinglish explanations."), false);
  assert.equal(persistedState.includes("Explain this simply"), false);
  assert.equal(persistedState.includes("This user prompt must never be persisted as feedback."), false);
  assert.equal(persistedState.includes("Legacy clients may send a note"), false);
  assert.equal(persistedState.includes("Explain the main idea first, then show one small worked example."), false);
  assert.equal(persistedState.includes("do-not-save"), false);

  const clearChat = await request("/api/chat/history", { method: "DELETE" });
  assert.equal(clearChat.status, 200);
  const emptyChatState = await request("/api/state");
  assert.deepEqual((await emptyChatState.json()).chats, []);

  const logout = await request("/api/logout", { method: "POST", body: JSON.stringify({}) });
  assert.equal(logout.status, 200);
  cookie = "";
  const afterLogout = await request("/api/state", { headers: {} });
  assert.equal(afterLogout.status, 401);
  assert.equal(afterLogout.status, 401);

  const reLogin = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-only-password-2026" })
  });
  assert.equal(reLogin.status, 200);
  cookie = (reLogin.headers.get("set-cookie") || "").split(";")[0];
  const freshSession = await request("/api/state");
  assert.deepEqual((await freshSession.json()).chats, []);
  const finalLogout = await request("/api/logout", { method: "POST", body: JSON.stringify({}) });
  assert.equal(finalLogout.status, 200);
  cookie = "";

});


test("specialist worker runtime is authenticated, sequential, persistent and evidence-verified", async () => {
  cookie = "";
  const unauthenticated = await request("/api/workers", { headers: {} });
  assert.equal(unauthenticated.status, 401);

  const login = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-only-password-2026" })
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  const catalogueResponse = await request("/api/workers");
  assert.equal(catalogueResponse.status, 200);
  const catalogue = await catalogueResponse.json();
  assert.equal(catalogue.workers.length, 8);
  assert.equal(catalogue.limits.externalActionExecution, false);
  assert.equal(catalogue.limits.generatedCodeExecution, false);

  const invalid = await request("/api/workers/dispatch", {
    method: "POST",
    body: JSON.stringify({ goal: "Send this to learner@example.com" })
  });
  assert.equal(invalid.status, 400);

  const approvalGate = await request("/api/workers/dispatch", {
    method: "POST",
    body: JSON.stringify({ goal: "Publish this video publicly on YouTube." })
  });
  assert.equal(approvalGate.status, 202);
  const waitingRun = (await approvalGate.json()).run;
  assert.equal(waitingRun.status, "waiting_for_user");
  assert.equal(waitingRun.steps[0].result.details.decision, "approval_required");
  assert.equal(waitingRun.steps[1].status, "skipped");

  const dispatched = await request("/api/workers/dispatch", {
    method: "POST",
    body: JSON.stringify({ goal: "Create an educational stick-figure animation storyboard about gravity." })
  });
  assert.equal(dispatched.status, 200);
  const payload = await dispatched.json();
  assert.equal(payload.run.status, "completed");
  assert.deepEqual(payload.run.workerIds, ["security", "media_creator", "verification"]);
  assert.equal(payload.run.steps[1].result.artifact.type, "media_storyboard");
  assert.equal(payload.run.steps[2].result.verification.passed, true);

  const storedMediaProjects = await request("/api/media/projects");
  assert.equal(storedMediaProjects.status, 200);
  const media = await storedMediaProjects.json();
  assert.ok(media.projects.some((item) => item.id === payload.run.steps[1].result.artifact.id));

  const runDetail = await request("/api/workers/runs/" + payload.run.id);
  assert.equal(runDetail.status, 200);
  assert.equal((await runDetail.json()).run.status, "completed");

  const stateFile = await fs.readFile(path.join(tempDir, "state.json"), "utf8");
  const persisted = JSON.parse(stateFile);
  assert.ok(persisted.workerRuns.some((item) => item.id === payload.run.id));
  assert.ok(Array.isArray(persisted.mediaProjects));

  const exportResponse = await request("/api/export");
  assert.equal(exportResponse.status, 200);
  const exportPayload = await exportResponse.json();
  assert.ok(exportPayload.data.workerRuns.some((item) => item.id === payload.run.id));

  const logout = await request("/api/logout", { method: "POST", body: JSON.stringify({}) });
  assert.equal(logout.status, 200);
  cookie = "";
});


test("scheduler endpoints persist approvals, task priority and schedule state", async () => {
  cookie = "";
  const blocked = await request("/api/schedules", { headers: {} });
  assert.equal(blocked.status, 401);

  const login = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-only-password-2026" })
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const createdTask = await request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: "Review scheduled study notes",
      description: "Test priority and pending summary.",
      dueAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      priority: "high"
    })
  });
  assert.equal(createdTask.status, 201);
  const task = (await createdTask.json()).task;
  assert.equal(task.priority, "high");

  const created = await request("/api/schedules", {
    method: "POST",
    body: JSON.stringify({
      kind: "reminder",
      title: "Evening revision",
      description: "Review the saved study notes.",
      dueAt,
      recurrence: "daily",
      timeZone: "Asia/Kolkata",
      priority: "high",
      browserNotificationApproved: false
    })
  });
  assert.equal(created.status, 201);
  const schedule = (await created.json()).schedule;
  assert.equal(schedule.status, "active");
  assert.equal(schedule.browserNotificationApproved, false);

  const listResponse = await request("/api/schedules");
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.ok(list.schedules.some((item) => item.id === schedule.id));
  assert.ok(list.pendingTasks.pending >= 1);
  assert.ok(list.pendingTasks.overdue >= 1);
  assert.ok(list.pendingTasks.highPriority >= 1);

  const paused = await request("/api/schedules/" + schedule.id, {
    method: "PATCH",
    body: JSON.stringify({ status: "paused" })
  });
  assert.equal(paused.status, 200);
  assert.equal((await paused.json()).schedule.status, "paused");

  const resumed = await request("/api/schedules/" + schedule.id, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" })
  });
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).schedule.status, "active");

  const invalidWorkflow = await request("/api/schedules", {
    method: "POST",
    body: JSON.stringify({
      kind: "workflow",
      title: "Run unapproved workflow",
      workflowId: "11111111-1111-4111-8111-111111111111",
      dueAt,
      recurrence: "once",
      timeZone: "Asia/Kolkata"
    })
  });
  assert.equal(invalidWorkflow.status, 409);

  const runtime = await request("/api/scheduler/status");
  assert.equal(runtime.status, 200);
  const runtimeData = await runtime.json();
  assert.equal(runtimeData.executionMode, "server-process");
  assert.equal(runtimeData.guaranteesWhileServerStopped, false);

  const stateFile = await fs.readFile(path.join(tempDir, "state.json"), "utf8");
  const persisted = JSON.parse(stateFile);
  assert.ok(persisted.schedules.some((item) => item.id === schedule.id));
  assert.ok(persisted.tasks.some((item) => item.id === task.id));

  const exported = await request("/api/export");
  assert.equal(exported.status, 200);
  const payload = await exported.json();
  assert.ok(payload.data.schedules.some((item) => item.id === schedule.id));

  const cancelled = await request("/api/schedules/" + schedule.id, { method: "DELETE" });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).schedule.status, "cancelled");

  const logout = await request("/api/logout", { method: "POST", body: JSON.stringify({}) });
  assert.equal(logout.status, 200);
  cookie = "";
});


test("media visual analysis requires a private session and an enabled AI provider", async () => {
  cookie = "";
  const payload = {
    project: { title: "Visual review", durationSeconds: 20 },
    frames: [
      { timestampSeconds: 1, dataUrl: "data:image/jpeg;base64," + "A".repeat(200) },
      { timestampSeconds: 10, dataUrl: "data:image/jpeg;base64," + "A".repeat(200) }
    ]
  };
  const blocked = await request("/api/media/analyze", {
    method: "POST",
    headers: {},
    body: JSON.stringify(payload)
  });
  assert.equal(blocked.status, 401);

  const login = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-only-password-2026" })
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  const unavailable = await request("/api/media/analyze", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error, /AI chat provider/i);

  await request("/api/logout", { method: "POST", body: JSON.stringify({}) });
  cookie = "";
});


test("media project API persists imported subtitle cues and caption style", async () => {
  cookie = "";
  const login = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-only-password-2026" })
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  const create = await request("/api/media/drafts", {
    method: "POST",
    body: JSON.stringify({
      title: "Subtitle API test",
      brief: "Explain how a rainbow forms.",
      format: "vertical-short",
      platform: "youtube-shorts",
      language: "en-IN",
      tone: "clear"
    })
  });
  assert.equal(create.status, 201);
  const project = (await create.json()).project;

  const update = await request("/api/media/projects/" + project.id, {
    method: "PATCH",
    body: JSON.stringify({
      captionCues: [
        { id: "cue-api-1", startSeconds: 1.25, endSeconds: 2.75, text: "Light bends in water droplets." },
        { id: "cue-api-2", startSeconds: 3.0, endSeconds: 4.5, text: "Different colours spread out." }
      ],
      captionStyle: { preset: "classic", position: "top", size: "large" },
      captionsEnabled: true
    })
  });
  assert.equal(update.status, 200);
  const saved = (await update.json()).project;
  assert.equal(saved.captionCues.length, 2);
  assert.equal(saved.captionCues[0].text, "Light bends in water droplets.");
  assert.deepEqual(saved.captionStyle, { preset: "classic", position: "top", size: "large" });
  assert.equal(saved.captionsEnabled, true);

  const approve = await request("/api/media/projects/" + project.id + "/approve", {
    method: "POST",
    body: JSON.stringify({})
  });
  assert.equal(approve.status, 200);
  const approved = (await approve.json()).project;
  assert.equal(approved.captionCues.length, 2);
  assert.equal(approved.captionStyle.position, "top");

  await request("/api/logout", { method: "POST", body: JSON.stringify({}) });
  cookie = "";
});
