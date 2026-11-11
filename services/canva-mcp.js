import crypto from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { decryptSecret, encryptSecret, isTokenVaultConfigured } from "./oauth.js";

export const CANVA_MCP_ENDPOINT = "https://api.canva.com/connect/v1/mcp";
export const CANVA_MCP_CALLBACK_PATH = "/api/integrations/canva/oauth/callback";
export const CANVA_MCP_TOOL_ALLOWLIST = Object.freeze([
  "__list_tools",
  "search-designs",
  "get-design",
  "get-design-pages",
  "get-design-content",
  "get-assets",
  "start-editing-transaction",
  "perform-editing-operations",
  "commit-editing-transaction",
  "cancel-editing-transaction",
  "get-design-thumbnail",
  "merge-designs",
  "resize-design",
  "create-upload-url",
  "export-design"
]);

const MCP_PENDING_TTL_MS = 10 * 60 * 1000;
const TOKEN_PURPOSE = "canva-mcp-token-bundle";
const PENDING_PURPOSE = "canva-mcp-pending-oauth";
const RESPONSIVE_EDIT_TYPES = new Set([
  "update_title",
  "update_fill",
  "delete_element",
  "find_and_replace_text"
]);
const ALL_EDIT_TYPES = new Set([
  ...RESPONSIVE_EDIT_TYPES,
  "insert_fill",
  "position_element",
  "resize_element",
  "format_text",
  "update_autofill_field"
]);

function clean(value, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest();
}

function safeCanvaDomain(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "canva.com" || url.hostname.endsWith(".canva.com") ||
       url.hostname === "canva.ai" || url.hostname.endsWith(".canva.ai"));
  } catch {
    return false;
  }
}

function getCanvaMcpConfig(env = process.env) {
  const clientId = clean(env.JARVIS_CANVA_OAUTH_CLIENT_ID, 500);
  const clientSecret = clean(env.JARVIS_CANVA_OAUTH_CLIENT_SECRET, 500);
  const redirectUri = clean(env.JARVIS_CANVA_OAUTH_REDIRECT_URI, 1000);
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Canva MCP is not configured. Set the existing JARVIS_CANVA_OAUTH_CLIENT_ID, JARVIS_CANVA_OAUTH_CLIENT_SECRET and JARVIS_CANVA_OAUTH_REDIRECT_URI values, then enable Canva MCP in the same Canva developer app.");
  }
  let callback;
  try { callback = new URL(redirectUri); } catch {
    throw new Error("The Canva OAuth callback URL is invalid.");
  }
  const localHttp = callback.protocol === "http:" && ["localhost", "127.0.0.1"].includes(callback.hostname);
  if ((!localHttp && callback.protocol !== "https:") ||
      callback.username || callback.password || callback.search || callback.hash ||
      callback.pathname !== CANVA_MCP_CALLBACK_PATH) {
    throw new Error("The Canva OAuth callback must be HTTPS and use the existing JARVIS Canva callback path.");
  }
  return { clientId, clientSecret, redirectUri };
}

function validEncryptedRecord(value) {
  return Boolean(value && value.version === 1 && value.algorithm === "aes-256-gcm" &&
    typeof value.iv === "string" && typeof value.tag === "string" &&
    typeof value.ciphertext === "string");
}

export function normalizeCanvaMcpConnection(input = {}) {
  if (input.provider !== "canva_mcp" || !validEncryptedRecord(input.encryptedTokenBundle)) {
    throw new TypeError("Invalid encrypted Canva MCP connection record.");
  }
  const connectedAt = clean(input.connectedAt, 40);
  const updatedAt = clean(input.updatedAt, 40);
  return {
    provider: "canva_mcp",
    encryptedTokenBundle: {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: input.encryptedTokenBundle.iv.slice(0, 64),
      tag: input.encryptedTokenBundle.tag.slice(0, 64),
      ciphertext: input.encryptedTokenBundle.ciphertext.slice(0, 24000)
    },
    connectedAt: Number.isFinite(Date.parse(connectedAt)) ? new Date(connectedAt).toISOString() : new Date().toISOString(),
    updatedAt: Number.isFinite(Date.parse(updatedAt)) ? new Date(updatedAt).toISOString() : new Date().toISOString()
  };
}

export function getCanvaMcpOAuthStatus(connection, env = process.env) {
  let configured = false;
  try { getCanvaMcpConfig(env); configured = true; } catch { /* report readiness only */ }
  const vaultConfigured = isTokenVaultConfigured(env);
  let normalized = null;
  try {
    normalized = connection ? normalizeCanvaMcpConnection(connection) : null;
    if (normalized) {
      const decoded = JSON.parse(decryptSecret(normalized.encryptedTokenBundle, {
        env,
        purpose: TOKEN_PURPOSE
      }));
      if (!decoded || typeof decoded.access_token !== "string" || !decoded.access_token) normalized = null;
    }
  } catch {
    normalized = null;
  }
  const connected = Boolean(normalized);
  return {
    provider: "canva_mcp",
    configured,
    vaultConfigured,
    canConnect: configured && vaultConfigured,
    connected,
    editingReady: connected,
    server: CANVA_MCP_ENDPOINT,
    callbackPath: CANVA_MCP_CALLBACK_PATH,
    accessBoundary: "Canva MCP supports supported design-element edits through reviewable editing transactions. Arbitrary Canva video-timeline trimming, keyframes, animation controls, font-family changes and unsupported responsive-page operations remain unavailable through this editing surface."
  };
}

function createOAuthProvider({ config, flow, onTokensSaved, onAuthorizationRedirect, allowInteractive = false }) {
  return {
    redirectUrl: config.redirectUri,
    clientMetadata: {
      client_name: "JARVIS Personal Assistant",
      redirect_uris: [config.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
      application_type: "web"
    },
    clientInformation(context) {
      if (!context?.issuer) return undefined;
      const issuer = clean(context.issuer, 1000);
      if (!safeCanvaDomain(issuer)) {
        throw new Error("Canva authorization discovery returned an untrusted issuer. No credentials were sent.");
      }
      return {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: [config.redirectUri],
        token_endpoint_auth_method: "client_secret_basic",
        issuer
      };
    },
    async saveClientInformation() {},
    tokens() {
      return flow.tokens;
    },
    async saveTokens(tokens) {
      flow.tokens = tokens;
      if (typeof onTokensSaved === "function") await onTokensSaved(tokens);
    },
    state() {
      if (!flow.state) flow.state = "jarvismcp_" + crypto.randomBytes(32).toString("base64url");
      return flow.state;
    },
    async saveCodeVerifier(verifier) {
      flow.codeVerifier = clean(verifier, 500);
    },
    codeVerifier() {
      if (!flow.codeVerifier) throw new Error("The Canva MCP PKCE verifier is missing. Start the connection again.");
      return flow.codeVerifier;
    },
    async saveDiscoveryState(state) {
      flow.discoveryState = state;
    },
    discoveryState() {
      return flow.discoveryState;
    },
    async redirectToAuthorization(url) {
      if (!safeCanvaDomain(url?.toString?.())) {
        throw new Error("Canva returned an untrusted authorization URL. The connection was stopped.");
      }
      if (!allowInteractive) {
        throw new Error("Canva authorization expired. Reconnect Canva from Creator Studio.");
      }
      flow.authorizationUrl = url.toString();
      if (typeof onAuthorizationRedirect === "function") await onAuthorizationRedirect(url);
    },
    async validateResourceURL(serverUrl, resource) {
      const server = new URL(serverUrl);
      if (server.origin !== "https://api.canva.com" || server.pathname !== "/connect/v1/mcp") {
        throw new Error("JARVIS refused an unexpected Canva MCP resource URL.");
      }
      if (resource) {
        const requested = new URL(resource);
        if (requested.origin !== server.origin ||
            (requested.pathname !== "/" && requested.pathname !== server.pathname)) {
          throw new Error("JARVIS refused an unexpected OAuth resource indicator.");
        }
      }
      return server;
    }
  };
}

function makeClient() {
  return new Client({ name: "jarvis-canva-editor", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
}

function makeTransport(provider) {
  return new StreamableHTTPClientTransport(new URL(CANVA_MCP_ENDPOINT), {
    authProvider: provider
  });
}

export async function beginCanvaMcpOAuth(options = {}) {
  const env = options.env || process.env;
  const runtimeStore = options.runtimeStore;
  if (!runtimeStore || typeof runtimeStore.savePendingOAuthState !== "function") {
    throw new Error("Secure temporary OAuth storage is unavailable. Configure the JARVIS runtime store and try again.");
  }
  const sessionToken = clean(options.sessionToken, 200);
  if (!sessionToken) throw new Error("Sign in to JARVIS before connecting Canva MCP.");
  const config = getCanvaMcpConfig(env);
  if (!isTokenVaultConfigured(env)) throw new Error("Encrypted token storage is not configured. Set JARVIS_TOKEN_ENCRYPTION_KEY first.");

  const flow = { state: "", codeVerifier: "", discoveryState: null, authorizationUrl: "", tokens: null };
  const binding = crypto.randomBytes(32).toString("base64url");
  const bindingHash = sha256(binding).toString("base64url");
  let savePromise = Promise.resolve();
  const provider = createOAuthProvider({
    config,
    flow,
    allowInteractive: true,
    onAuthorizationRedirect: async () => {
      const state = flow.state;
      if (!state || !flow.codeVerifier) {
        throw new Error("Canva OAuth did not produce a valid PKCE state. Start the connection again.");
      }
      const now = Date.now();
      const bundle = {
        codeVerifier: flow.codeVerifier,
        discoveryState: flow.discoveryState
      };
      const pending = {
        sessionHash: runtimeStore.hashIdentifier(sessionToken),
        browserBindingHash: bindingHash,
        requestedScopes: [],
        capability: "canva_mcp",
        encryptedVerifier: encryptSecret(JSON.stringify(bundle), {
          env,
          purpose: PENDING_PURPOSE
        }),
        createdAt: now,
        expiresAt: now + MCP_PENDING_TTL_MS
      };
      savePromise = runtimeStore.savePendingOAuthState(
        sha256(state).toString("base64url"),
        pending
      );
      await savePromise;
    }
  });

  const client = makeClient();
  const transport = makeTransport(provider);
  try {
    await client.connect(transport);
    return { connected: true, authorizationUrl: "", browserBinding: binding };
  } catch (error) {
    await savePromise;
    if (!flow.authorizationUrl) {
      const message = error?.message || "Canva MCP could not start authorization.";
      throw new Error(message.slice(0, 240));
    }
    return {
      connected: false,
      authorizationUrl: flow.authorizationUrl,
      browserBinding: binding,
      expiresInSeconds: Math.floor(MCP_PENDING_TTL_MS / 1000)
    };
  } finally {
    try { await client.close(); } catch { /* connection may not have opened */ }
  }
}

export async function finishCanvaMcpOAuth(options = {}) {
  const env = options.env || process.env;
  const runtimeStore = options.runtimeStore;
  const state = clean(options.state, 240);
  if (!runtimeStore || typeof runtimeStore.consumePendingOAuthState !== "function" || !state.startsWith("jarvismcp_")) {
    throw new Error("Canva MCP OAuth state is invalid.");
  }
  const pending = await runtimeStore.consumePendingOAuthState(sha256(state).toString("base64url"));
  if (!pending || pending.capability !== "canva_mcp") {
    throw new Error("Canva MCP authorization expired or was already used. Start the connection again.");
  }
  const bindingHash = sha256(clean(options.browserBinding, 200)).toString("base64url");
  if (bindingHash.length !== pending.browserBindingHash.length ||
      !crypto.timingSafeEqual(Buffer.from(bindingHash), Buffer.from(pending.browserBindingHash))) {
    throw new Error("Canva MCP browser verification failed. Start the connection again.");
  }
  if (pending.expiresAt <= Date.now()) throw new Error("Canva MCP authorization expired. Start the connection again.");
  if (typeof options.isSessionValid !== "function" || !await options.isSessionValid(pending.sessionHash)) {
    throw new Error("Your JARVIS session expired. Sign in and reconnect Canva.");
  }
  if (options.oauthError) throw new Error("Canva authorization was cancelled or denied.");
  const params = options.params instanceof URLSearchParams
    ? options.params
    : new URLSearchParams(options.queryString || "");
  if (params.get("state") !== state || !clean(params.get("code"), 4000)) {
    throw new Error("Canva did not return a valid authorization code.");
  }

  let bundle;
  try {
    bundle = JSON.parse(decryptSecret(pending.encryptedVerifier, {
      env,
      purpose: PENDING_PURPOSE
    }));
  } catch {
    throw new Error("Canva MCP authorization could not be recovered. Start the connection again.");
  }
  const config = getCanvaMcpConfig(env);
  const flow = {
    state,
    codeVerifier: clean(bundle?.codeVerifier, 500),
    discoveryState: bundle?.discoveryState || null,
    authorizationUrl: "",
    tokens: null
  };
  if (!flow.codeVerifier) throw new Error("Canva MCP PKCE state is incomplete. Start the connection again.");

  const provider = createOAuthProvider({ config, flow, allowInteractive: false });
  const transport = makeTransport(provider);
  try {
    await transport.finishAuth(params);
  } catch {
    throw new Error("Canva could not complete secure authorization. Check the Canva MCP app settings and try connecting again.");
  } finally {
    try { await transport.close(); } catch { /* no live stream required */ }
  }
  if (!flow.tokens || typeof flow.tokens.access_token !== "string" || !flow.tokens.access_token) {
    throw new Error("Canva did not return an access token. No connection was saved.");
  }
  const now = new Date().toISOString();
  return normalizeCanvaMcpConnection({
    provider: "canva_mcp",
    encryptedTokenBundle: encryptSecret(JSON.stringify(flow.tokens), {
      env,
      purpose: TOKEN_PURPOSE
    }),
    connectedAt: now,
    updatedAt: now
  });
}

function unpackToolResult(result) {
  if (!result || typeof result !== "object") throw new Error("Canva returned an empty tool response.");
  if (result.isError) {
    const message = Array.isArray(result.content)
      ? result.content.filter((part) => part?.type === "text").map((part) => part.text).join(" ")
      : "";
    throw new Error(clean(message, 400) || "Canva could not complete the requested editing action.");
  }
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const texts = Array.isArray(result.content)
    ? result.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text)
    : [];
  for (const text of texts) {
    try { return JSON.parse(text); } catch { /* keep searching */ }
  }
  return { content: result.content || [] };
}

export async function callCanvaMcpTool(options = {}) {
  const env = options.env || process.env;
  const connection = normalizeCanvaMcpConnection(options.connection || {});
  const name = clean(options.name, 80);
  if (!CANVA_MCP_TOOL_ALLOWLIST.includes(name)) {
    throw new TypeError("This Canva MCP action is not enabled in JARVIS.");
  }
  let tokens;
  try {
    tokens = JSON.parse(decryptSecret(connection.encryptedTokenBundle, {
      env,
      purpose: TOKEN_PURPOSE
    }));
  } catch {
    throw new Error("The stored Canva MCP connection could not be decrypted. Reconnect Canva and check the server encryption key.");
  }
  const config = getCanvaMcpConfig(env);
  const flow = { state: "", codeVerifier: "", discoveryState: null, authorizationUrl: "", tokens };
  let refreshedTokens = null;
  const provider = createOAuthProvider({
    config,
    flow,
    allowInteractive: false,
    onTokensSaved: async (nextTokens) => { refreshedTokens = nextTokens; }
  });
  const client = makeClient();
  const transport = makeTransport(provider);
  try {
    await client.connect(transport);
    const discovery = await client.listTools();
    const liveTools = Array.isArray(discovery?.tools) ? discovery.tools : [];
    if (name === "__list_tools") return { tools: liveTools };
    const availableTool = liveTools.find((tool) => tool?.name === name);
    if (!availableTool) {
      throw new Error("Canva MCP did not advertise the requested tool: " + name + ". Refresh the editor's tool list and try again.");
    }
    const result = await client.callTool({ name, arguments: options.arguments || {} });
    if (refreshedTokens && typeof options.onTokensUpdated === "function") {
      await options.onTokensUpdated(normalizeCanvaMcpConnection({
        ...connection,
        encryptedTokenBundle: encryptSecret(JSON.stringify(refreshedTokens), {
          env,
          purpose: TOKEN_PURPOSE
        }),
        updatedAt: new Date().toISOString()
      }));
    }
    return unpackToolResult(result);
  } catch (error) {
    if (/authorization|unauthorized|token expired|reconnect/i.test(error?.message || "")) {
      throw new Error("Canva MCP authorization is no longer valid. Reconnect Canva from Creator Studio.");
    }
    throw new Error(clean(error?.message, 400) || "Canva could not complete the requested action.");
  } finally {
    try { await client.close(); } catch { /* best-effort cleanup */ }
  }
}

function finiteNumber(value, label, min, max, allowMissing = false) {
  if (allowMissing && value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new TypeError(label + " must be between " + min + " and " + max + ".");
  }
  return number;
}

function safeElementId(value) {
  const id = clean(value, 160);
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new TypeError("A valid Canva element ID is required.");
  return id;
}

function validateFormatting(formatting = {}) {
  if (!formatting || typeof formatting !== "object" || Array.isArray(formatting)) {
    throw new TypeError("Text formatting must be an object.");
  }
  const result = {};
  if (formatting.font_size !== undefined) {
    const size = finiteNumber(formatting.font_size, "Font size", 1, 800);
    if (!Number.isInteger(size)) throw new TypeError("Font size must be a whole number.");
    result.font_size = size;
  }
  if (formatting.text_align !== undefined) {
    if (!["start", "center", "end"].includes(formatting.text_align)) throw new TypeError("Choose start, center or end text alignment.");
    result.text_align = formatting.text_align;
  }
  if (formatting.color !== undefined) {
    if (typeof formatting.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(formatting.color)) throw new TypeError("Text colour must be a six-digit hex colour.");
    result.color = formatting.color;
  }
  if (formatting.font_weight !== undefined) {
    if (!["normal", "bold"].includes(formatting.font_weight)) throw new TypeError("Font weight must be normal or bold.");
    result.font_weight = formatting.font_weight;
  }
  if (formatting.font_style !== undefined) {
    if (!["normal", "italic"].includes(formatting.font_style)) throw new TypeError("Font style must be normal or italic.");
    result.font_style = formatting.font_style;
  }
  if (formatting.decoration !== undefined) {
    if (!["none", "underline"].includes(formatting.decoration)) throw new TypeError("Text decoration must be none or underline.");
    result.decoration = formatting.decoration;
  }
  if (formatting.strikethrough !== undefined) {
    if (!["none", "strikethrough"].includes(formatting.strikethrough)) throw new TypeError("Strikethrough value is invalid.");
    result.strikethrough = formatting.strikethrough;
  }
  if (formatting.link !== undefined) {
    if (formatting.link !== "" && (typeof formatting.link !== "string" || !/^https:\/\//i.test(formatting.link) || formatting.link.length > 2000)) {
      throw new TypeError("Text links must use an HTTPS URL or be empty to remove the link.");
    }
    result.link = formatting.link;
  }
  if (formatting.list_level !== undefined) {
    const level = finiteNumber(formatting.list_level, "List level", 0, 10);
    if (!Number.isInteger(level)) throw new TypeError("List level must be a whole number.");
    result.list_level = level;
  }
  if (formatting.list_marker !== undefined) {
    if (!["none", "disc", "circle", "square", "decimal", "lower-alpha", "lower-roman"].includes(formatting.list_marker)) {
      throw new TypeError("List marker style is invalid.");
    }
    result.list_marker = formatting.list_marker;
  }
  if (formatting.line_height !== undefined) result.line_height = finiteNumber(formatting.line_height, "Line height", 0.5, 2.5);
  if (!Object.keys(result).length) throw new TypeError("Choose at least one text-formatting change.");
  return result;
}

export function validateCanvaEditingOperations({ operations, pages, pageIndex }) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 50) {
    throw new TypeError("Choose between 1 and 50 Canva editing operations.");
  }
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 500) {
    throw new TypeError("Load the Canva design pages before applying edits.");
  }
  const index = finiteNumber(pageIndex, "Page number", 1, 500);
  const page = pages.find((item) => Number(item?.page_number ?? item?.page_index ?? item?.index) === index);
  if (!page) throw new TypeError("The selected page is not part of the active Canva editing transaction.");
  if (page.is_editable === false) throw new TypeError("This Canva page is not editable through the current integration.");
  const responsive = page.is_responsive === true;

  return operations.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Each Canva edit must be an operation object.");
    const type = clean(raw.type, 48);
    if (!ALL_EDIT_TYPES.has(type)) throw new TypeError("Unsupported Canva editing operation: " + type + ".");
    if (responsive && !RESPONSIVE_EDIT_TYPES.has(type)) {
      throw new TypeError("This responsive Canva page supports text replacement, media replacement, delete and title updates only. Layout and formatting edits are not supported here.");
    }
    const op = { type };
    if (type === "update_title") {
      op.title = clean(raw.title, 255);
      if (!op.title) throw new TypeError("A design title is required.");
    } else if (type === "replace_text") {
      op.element_id = safeElementId(raw.element_id);
      if (typeof raw.text !== "string" || raw.text.length > 8000) throw new TypeError("Replacement text must be no more than 8,000 characters.");
      op.text = raw.text;
    } else if (type === "find_and_replace_text") {
      op.element_id = safeElementId(raw.element_id);
      op.find_text = clean(raw.find_text, 2000);
      if (!op.find_text || typeof raw.replace_text !== "string" || raw.replace_text.length > 8000) {
        throw new TypeError("Find-and-replace needs search text and replacement text.");
      }
      op.replace_text = raw.replace_text;
    } else if (type === "format_text") {
      op.element_id = safeElementId(raw.element_id);
      op.formatting = validateFormatting(raw.formatting);
    } else if (type === "update_fill") {
      op.element_id = safeElementId(raw.element_id);
      if (!["image", "video"].includes(raw.asset_type)) throw new TypeError("A Canva fill must be an image or video.");
      op.asset_type = raw.asset_type;
      op.asset_id = safeElementId(raw.asset_id);
      op.alt_text = clean(raw.alt_text, 250);
    } else if (type === "insert_fill") {
      const pageId = clean(raw.page_id, 160);
      if (!pageId || !pages.some((item) => item?.page_id === pageId)) throw new TypeError("Choose a valid page from this design.");
      if (!["image", "video"].includes(raw.asset_type)) throw new TypeError("Only image or video fills can be inserted.");
      op.page_id = pageId;
      op.asset_type = raw.asset_type;
      op.asset_id = safeElementId(raw.asset_id);
      op.alt_text = clean(raw.alt_text, 250);
      op.top = finiteNumber(raw.top, "Top position", -100000, 100000, true);
      op.left = finiteNumber(raw.left, "Left position", -100000, 100000, true);
      op.width = finiteNumber(raw.width, "Width", 1, 100000, true);
      op.height = finiteNumber(raw.height, "Height", 1, 100000, true);
      op.rotation = finiteNumber(raw.rotation, "Rotation", -180, 180, true);
      op.opacity = finiteNumber(raw.opacity, "Opacity", 0, 1, true);
    } else if (type === "delete_element") {
      op.element_id = safeElementId(raw.element_id);
    } else if (type === "position_element") {
      op.element_id = safeElementId(raw.element_id);
      op.top = finiteNumber(raw.top, "Top position", -100000, 100000);
      op.left = finiteNumber(raw.left, "Left position", -100000, 100000);
    } else if (type === "resize_element") {
      op.element_id = safeElementId(raw.element_id);
      const preserve = raw.preserve_aspect_ratio === true;
      op.preserve_aspect_ratio = preserve;
      if (raw.width !== undefined) op.width = finiteNumber(raw.width, "Width", 1, 100000);
      if (raw.height !== undefined) op.height = finiteNumber(raw.height, "Height", 1, 100000);
      if (!op.width && !op.height) throw new TypeError("Provide a new width or height.");
      if (!preserve && (op.width === undefined || op.height === undefined)) {
        throw new TypeError("Provide both width and height when aspect ratio is not preserved.");
      }
      if (preserve && op.width !== undefined && op.height !== undefined) {
        throw new TypeError("When preserving aspect ratio, provide width or height, not both.");
      }
    } else if (type === "update_autofill_field") {
      op.element_id = safeElementId(raw.element_id);
      const label = clean(raw.autofill_field_label, 100);
      if (raw.autofill_field_label !== undefined && !label) throw new TypeError("Autofill field labels cannot be blank.");
      if (label) op.autofill_field_label = label;
    }
    return op;
  });
}

export function validateCanvaPageMerge({ type, designId, title, operations, confirmed = false }) {
  if (!confirmed) throw new Error("Confirm the exact Canva page changes before applying them.");
  if (!["create_new_design", "modify_existing_design"].includes(type)) throw new TypeError("Choose whether to create a new design or modify an existing design.");
  if (!Array.isArray(operations) || operations.length !== 1) {
    throw new TypeError("Canva accepts exactly one page operation per request. Apply multiple page changes one at a time.");
  }
  if (type === "modify_existing_design" && !/^D[A-Za-z0-9_-]{10,}$/.test(clean(designId, 80))) {
    throw new TypeError("A valid Canva design ID is required.");
  }
  if (type === "create_new_design" && !clean(title, 255)) throw new TypeError("A title is required when creating a new page-combined design.");
  return {
    type,
    ...(type === "modify_existing_design" ? { design_id: designId } : { title: clean(title, 255) }),
    operations: operations.map((item) => {
      if (!item || typeof item !== "object") throw new TypeError("Each page operation must be an object.");
      if (item.type === "insert_pages") {
        const sourceId = clean(item.source?.design_id, 80);
        if (!/^D[A-Za-z0-9_-]{10,}$/.test(sourceId)) throw new TypeError("A valid source design ID is required.");
        const after = item.after_page_number === undefined ? undefined : finiteNumber(item.after_page_number, "Insert after page", 0, 500);
        const pageNumbers = Array.isArray(item.source.page_numbers)
          ? item.source.page_numbers.map((value) => finiteNumber(value, "Source page", 1, 500))
          : undefined;
        return { type: "insert_pages", source: { type: "design", design_id: sourceId, ...(pageNumbers ? { page_numbers: pageNumbers } : {}) }, ...(after !== undefined ? { after_page_number: after } : {}) };
      }
      if (item.type === "move_pages") {
        if (!Array.isArray(item.from_page_numbers) || !item.from_page_numbers.length) throw new TypeError("Choose one or more pages to move.");
        return {
          type: "move_pages",
          from_page_numbers: item.from_page_numbers.map((value) => finiteNumber(value, "Page to move", 1, 500)),
          to_after_page_number: finiteNumber(item.to_after_page_number, "Move destination page", 0, 500)
        };
      }
      if (item.type === "delete_pages") {
        if (!Array.isArray(item.page_numbers) || !item.page_numbers.length) throw new TypeError("Choose one or more pages to delete.");
        return { type: "delete_pages", page_numbers: item.page_numbers.map((value) => finiteNumber(value, "Page to delete", 1, 500)) };
      }
      throw new TypeError("Unsupported Canva page operation.");
    })
  };
}

export function decodeCanvaMcpToolResult(result) {
  return unpackToolResult(result);
}

export function getCanvaMcpConfigStatus(env = process.env) {
  let configured = false;
  let configError = "";
  try { getCanvaMcpConfig(env); configured = true; } catch (error) { configError = clean(error?.message, 240); }
  return { configured, server: CANVA_MCP_ENDPOINT, callbackPath: CANVA_MCP_CALLBACK_PATH, ...(configError ? { message: configError } : {}) };
}
