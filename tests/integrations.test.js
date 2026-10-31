import { test } from "node:test";
import assert from "node:assert/strict";
import { getIntegrationCatalog, probeIntegration, runIntegrationAction } from "../services/integrations.js";

function fakeFetch(payload, status = 200) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

test("integration catalogue reports configuration without including credential values", () => {
  const catalogue = getIntegrationCatalog({ JARVIS_GITHUB_TOKEN: "demo-github-value" });
  const github = catalogue.find((item) => item.id === "github");
  const drive = catalogue.find((item) => item.id === "google_drive");
  assert.equal(github.configured, true);
  assert.equal(github.environmentVariable, "JARVIS_GITHUB_TOKEN");
  assert.equal(drive.configured, false);
  assert.equal(JSON.stringify(catalogue).includes("demo-github-value"), false);
});

test("GitHub profile probe uses a fixed GET endpoint and returns bounded profile data", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { name: "Jarvis", full_name: "jarvis-user/Jarvis", private: true, updated_at: "2026-10-30T10:00:00Z", html_url: "https://github.com/jarvis-user/Jarvis" }
  ]);
  const result = await probeIntegration("github", {
    env: { JARVIS_GITHUB_TOKEN: "demo-github-value" },
    fetchImpl
  });
  assert.equal(result.connected, true);
  assert.equal(result.details.recentRepositories, 1);
  assert.equal(result.details.latestRepository, "jarvis-user/Jarvis");
  assert.equal(JSON.stringify(result).includes("demo-github-value"), false);
  assert.equal(calls[0].url, "https://api.github.com/user/repos?per_page=1&sort=updated");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer demo-github-value");
  assert.equal(calls[0].options.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal(calls[0].options.headers.Accept, "application/vnd.github+json");
  assert.equal(calls[0].options.redirect, "error");
});

test("GitHub workflow action returns a small repository summary", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { name: "Jarvis", full_name: "jarvis-user/Jarvis", private: true, updated_at: "2026-10-30T10:00:00Z", html_url: "https://github.com/jarvis-user/Jarvis", other: "not returned" },
    { name: "Public", full_name: "jarvis-user/Public", private: false, updated_at: "2026-10-29T10:00:00Z", html_url: "https://invalid.example/not-github" }
  ]);
  const result = await runIntegrationAction("github_list_repositories", {
    env: { JARVIS_GITHUB_TOKEN: "demo-github-value" },
    fetchImpl
  });
  assert.equal(result.repositories.length, 2);
  assert.equal(result.repositories[0].private, true);
  assert.equal(result.repositories[1].url, "");
  assert.equal(Object.hasOwn(result.repositories[0], "other"), false);
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/user\/repos\?/);
});

test("Google Drive action returns no more than eight file metadata records", async () => {
  const files = Array.from({ length: 12 }, (_, index) => ({
    id: "file-" + index,
    name: "Study note " + index,
    mimeType: "application/pdf",
    modifiedTime: "2026-10-30T10:00:00Z",
    webViewLink: "https://drive.google.com/file/d/file-" + index + "/view",
    other: "not returned"
  }));
  const { fetchImpl, calls } = fakeFetch({ files });
  const result = await runIntegrationAction("google_drive_list_files", {
    env: { JARVIS_GOOGLE_DRIVE_ACCESS_TOKEN: "demo-drive-value" },
    fetchImpl
  });
  assert.equal(result.files.length, 8);
  assert.equal(result.files[0].name, "Study note 0");
  assert.equal(Object.hasOwn(result.files[0], "other"), false);
  assert.match(calls[0].url, /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer demo-drive-value");
});

test("Telegram profile probe checks a bot without returning its configured value", async () => {
  const demoBotValue = "123456:" + "A".repeat(30);
  const { fetchImpl, calls } = fakeFetch({
    ok: true,
    result: { is_bot: true, first_name: "Jarvis Bot", username: "jarvis_test_bot", can_join_groups: true, supports_inline_queries: false }
  });
  const result = await probeIntegration("telegram", {
    env: { JARVIS_TELEGRAM_BOT_TOKEN: demoBotValue },
    fetchImpl
  });
  assert.equal(result.details.username, "jarvis_test_bot");
  assert.equal(result.details.bot, true);
  assert.equal(JSON.stringify(result).includes(demoBotValue), false);
  assert.ok(calls[0].url.endsWith("/getMe"));
});

test("ElevenLabs probe returns a limited subscription summary", async () => {
  const { fetchImpl } = fakeFetch({
    first_name: "JARVIS",
    subscription: { tier: "starter", character_limit: 30000, character_count: 4500 },
    other: "not returned"
  });
  const result = await probeIntegration("elevenlabs", {
    env: { JARVIS_ELEVENLABS_API_KEY: "demo-eleven-value" },
    fetchImpl
  });
  assert.equal(result.details.tier, "starter");
  assert.equal(result.details.characterLimit, 30000);
  assert.equal(Object.hasOwn(result.details, "other"), false);
});

test("missing GitHub configuration fails before making an outbound call", async () => {
  let calls = 0;
  await assert.rejects(
    () => probeIntegration("github", { env: {}, fetchImpl: async () => { calls += 1; } }),
    /JARVIS_GITHUB_TOKEN/
  );
  assert.equal(calls, 0);
});

test("malformed Telegram configuration is rejected before making an outbound call", async () => {
  let calls = 0;
  await assert.rejects(
    () => probeIntegration("telegram", { env: { JARVIS_TELEGRAM_BOT_TOKEN: "not-valid" }, fetchImpl: async () => { calls += 1; } }),
    /token format is invalid/i
  );
  assert.equal(calls, 0);
});

test("provider HTTP errors are reduced to safe status messages", async () => {
  const { fetchImpl } = fakeFetch({ message: "not included in the error" }, 401);
  await assert.rejects(
    () => probeIntegration("github", { env: { JARVIS_GITHUB_TOKEN: "demo-github-value" }, fetchImpl }),
    /rejected the configured credential/i
  );
});

test("unknown provider names and actions are rejected", async () => {
  await assert.rejects(() => probeIntegration("custom_url"), /unknown integration provider/i);
  await assert.rejects(() => runIntegrationAction("fetch_url"), /unknown or unsupported integration action/i);
});
