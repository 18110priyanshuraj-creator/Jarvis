const REQUEST_TIMEOUT_MS = 8000;

const PROVIDERS = Object.freeze({
  github: {
    name: "GitHub",
    environmentVariable: "JARVIS_GITHUB_TOKEN",
    access: "Read-only profile and repository list",
    capabilities: ["list_repositories", "check_connection"]
  },
  google_drive: {
    name: "Google Drive",
    environmentVariable: "JARVIS_GOOGLE_DRIVE_ACCESS_TOKEN",
    access: "Read-only list of recent file names and metadata",
    capabilities: ["list_files", "check_connection"]
  },
  telegram: {
    name: "Telegram",
    environmentVariable: "JARVIS_TELEGRAM_BOT_TOKEN",
    access: "Read-only bot profile check; does not send messages",
    capabilities: ["bot_profile", "check_connection"]
  },
  elevenlabs: {
    name: "ElevenLabs",
    environmentVariable: "JARVIS_ELEVENLABS_API_KEY",
    access: "Read-only account and subscription summary",
    capabilities: ["account_summary", "check_connection"]
  }
});

function credential(provider, env) {
  const name = PROVIDERS[provider]?.environmentVariable;
  return name ? String(env?.[name] || "").trim() : "";
}

function safeStatus(status) {
  if (status === 401 || status === 403) return "The service rejected the configured credential. Check it in your server environment.";
  if (status === 404) return "The service endpoint was not found.";
  if (status === 429) return "The service rate limit was reached. Try again later.";
  if (status >= 500) return "The external service is temporarily unavailable.";
  return "The external service request failed. Check the connection and try again.";
}

async function requestJson(url, headers, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("The integration request timed out. Try again later.");
    }
    throw new Error("Could not connect to the external service.");
  }

  if (!response.ok) throw new Error(safeStatus(response.status));
  try {
    return await response.json();
  } catch {
    throw new Error("The external service returned an unreadable response.");
  }
}

function requireCredential(provider, env) {
  const token = credential(provider, env);
  if (!token) throw new Error(PROVIDERS[provider].name + " is not configured. Add " + PROVIDERS[provider].environmentVariable + " to the server environment.");
  return token;
}

async function githubRequest(path, env, fetchImpl) {
  const token = requireCredential("github", env);
  return requestJson("https://api.github.com" + path, {
    Authorization: "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28"
  }, fetchImpl);
}

async function driveRequest(env, fetchImpl) {
  const token = requireCredential("google_drive", env);
  const url = "https://www.googleapis.com/drive/v3/files?pageSize=8&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)";
  return requestJson(url, { Authorization: "Bearer " + token }, fetchImpl);
}

async function telegramRequest(env, fetchImpl) {
  const token = requireCredential("telegram", env);
  if (!/^[0-9]{5,16}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error("Telegram bot token format is invalid. Check it in your server environment.");
  }
  return requestJson("https://api.telegram.org/bot" + token + "/getMe", {}, fetchImpl);
}

async function elevenLabsRequest(env, fetchImpl) {
  const token = requireCredential("elevenlabs", env);
  return requestJson("https://api.elevenlabs.io/v1/user", { "xi-api-key": token }, fetchImpl);
}

function sanitizeGitHubProfile(data) {
  return {
    login: String(data?.login || "").slice(0, 80),
    name: String(data?.name || "").slice(0, 100),
    publicRepos: Number.isFinite(data?.public_repos) ? data.public_repos : null,
    profileUrl: typeof data?.html_url === "string" && data.html_url.startsWith("https://github.com/") ? data.html_url : ""
  };
}

function sanitizeGitHubRepos(data) {
  return (Array.isArray(data) ? data : []).slice(0, 8).map((repo) => ({
    name: String(repo?.name || "").slice(0, 100),
    fullName: String(repo?.full_name || "").slice(0, 160),
    private: Boolean(repo?.private),
    updatedAt: String(repo?.updated_at || "").slice(0, 40),
    url: typeof repo?.html_url === "string" && repo.html_url.startsWith("https://github.com/") ? repo.html_url : ""
  }));
}

function sanitizeDriveFiles(data) {
  return (Array.isArray(data?.files) ? data.files : []).slice(0, 8).map((file) => ({
    id: String(file?.id || "").slice(0, 100),
    name: String(file?.name || "Untitled file").slice(0, 160),
    mimeType: String(file?.mimeType || "").slice(0, 120),
    modifiedAt: String(file?.modifiedTime || "").slice(0, 40),
    url: typeof file?.webViewLink === "string" && file.webViewLink.startsWith("https://") ? file.webViewLink : ""
  }));
}

function sanitizeTelegramProfile(data) {
  const result = data?.result || {};
  if (data?.ok !== true) throw new Error("Telegram could not validate the configured bot token.");
  return {
    bot: Boolean(result.is_bot),
    username: String(result.username || "").slice(0, 80),
    firstName: String(result.first_name || "").slice(0, 80),
    canJoinGroups: Boolean(result.can_join_groups),
    supportsInlineQueries: Boolean(result.supports_inline_queries)
  };
}

function sanitizeElevenLabsAccount(data) {
  const subscription = data?.subscription || {};
  return {
    firstName: String(data?.first_name || "").slice(0, 80),
    tier: String(subscription?.tier || "unknown").slice(0, 60),
    characterLimit: Number.isFinite(subscription?.character_limit) ? subscription.character_limit : null,
    charactersUsed: Number.isFinite(subscription?.character_count) ? subscription.character_count : null
  };
}

export function getIntegrationCatalog(env = process.env) {
  return Object.entries(PROVIDERS).map(([id, provider]) => ({
    id,
    name: provider.name,
    environmentVariable: provider.environmentVariable,
    access: provider.access,
    capabilities: [...provider.capabilities],
    configured: Boolean(credential(id, env)),
    enabled: Boolean(credential(id, env))
  }));
}

export async function probeIntegration(provider, options = {}) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new TypeError("Unknown integration provider.");
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  let details;
  if (provider === "github") {
    details = sanitizeGitHubProfile(await githubRequest("/user", env, fetchImpl));
  } else if (provider === "google_drive") {
    details = { recentFiles: sanitizeDriveFiles(await driveRequest(env, fetchImpl)).length };
  } else if (provider === "telegram") {
    details = sanitizeTelegramProfile(await telegramRequest(env, fetchImpl));
  } else {
    details = sanitizeElevenLabsAccount(await elevenLabsRequest(env, fetchImpl));
  }
  return {
    provider,
    name: PROVIDERS[provider].name,
    connected: true,
    checkedAt: new Date().toISOString(),
    details
  };
}

export async function runIntegrationAction(action, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  if (action === "github_list_repositories") {
    const data = await githubRequest("/user/repos?per_page=8&sort=updated", env, fetchImpl);
    const repositories = sanitizeGitHubRepos(data);
    return { repositories, summary: "Retrieved " + repositories.length + " GitHub repository/repositories." };
  }
  if (action === "google_drive_list_files") {
    const files = sanitizeDriveFiles(await driveRequest(env, fetchImpl));
    return { files, summary: "Retrieved " + files.length + " recent Google Drive file(s)." };
  }
  if (action === "telegram_get_bot_profile") {
    const profile = sanitizeTelegramProfile(await telegramRequest(env, fetchImpl));
    return { profile, summary: profile.username ? "Connected to Telegram bot @" + profile.username + "." : "Telegram bot connection verified." };
  }
  if (action === "elevenlabs_get_account") {
    const account = sanitizeElevenLabsAccount(await elevenLabsRequest(env, fetchImpl));
    return { account, summary: "Retrieved the ElevenLabs account and subscription summary." };
  }
  throw new TypeError("Unknown or unsupported integration action.");
}

export const INTEGRATION_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
