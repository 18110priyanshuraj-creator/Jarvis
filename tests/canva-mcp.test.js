import test from "node:test";
import assert from "node:assert/strict";
import {
  getCanvaMcpOAuthStatus,
  normalizeCanvaMcpConnection,
  validateCanvaEditingOperations,
  validateCanvaPageMerge
} from "../services/canva-mcp.js";
import { encryptSecret } from "../services/oauth.js";

const env = {
  JARVIS_CANVA_OAUTH_CLIENT_ID: "jarvis-canva-client",
  JARVIS_CANVA_OAUTH_CLIENT_SECRET: "jarvis-canva-secret",
  JARVIS_CANVA_OAUTH_REDIRECT_URI: "https://jarvis.example.com/api/integrations/canva/oauth/callback",
  JARVIS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64")
};

const pages = [
  { page_id: "page-1", page_number: 1, is_responsive: false, is_editable: true },
  { page_id: "page-2", page_number: 2, is_responsive: true, is_editable: true }
];

test("Canva MCP status distinguishes configuration, token vault and saved connection", () => {
  assert.equal(getCanvaMcpOAuthStatus(null, {}).configured, false);
  const ready = getCanvaMcpOAuthStatus(null, env);
  assert.equal(ready.configured, true);
  assert.equal(ready.vaultConfigured, true);
  assert.equal(ready.canConnect, true);
  assert.equal(ready.connected, false);

  const connection = normalizeCanvaMcpConnection({
    provider: "canva_mcp",
    encryptedTokenBundle: encryptSecret(JSON.stringify({
      access_token: "canva-access-token",
      refresh_token: "canva-refresh-token",
      token_type: "Bearer"
    }), { env, purpose: "canva-mcp-token-bundle" })
  });
  const connected = getCanvaMcpOAuthStatus(connection, env);
  assert.equal(connected.connected, true);
  assert.equal(connected.editingReady, true);
  assert.equal(JSON.stringify(connection).includes("canva-access-token"), false);
});

test("fixed-page transaction allows text, formatting, media, and layout operations", () => {
  const operations = validateCanvaEditingOperations({
    pages,
    pageIndex: 1,
    operations: [
      { type: "replace_text", element_id: "text_123", text: "A reviewed new headline" },
      { type: "format_text", element_id: "text_123", formatting: { font_size: 48, color: "#224466", font_weight: "bold", text_align: "center" } },
      { type: "position_element", element_id: "text_123", top: 120, left: 80 },
      { type: "resize_element", element_id: "text_123", width: 720, height: 180 },
      { type: "update_fill", element_id: "media_123", asset_type: "image", asset_id: "asset_456", alt_text: "New background" },
      { type: "insert_fill", page_id: "page-1", asset_type: "video", asset_id: "asset_789", top: 50, left: 50, width: 600, height: 340 }
    ]
  });
  assert.equal(operations.length, 6);
  assert.equal(operations[1].formatting.font_size, 48);
  assert.equal(operations[4].asset_type, "image");
});

test("responsive pages reject layout and format controls but allow text and media replacement", () => {
  const allowed = validateCanvaEditingOperations({
    pages,
    pageIndex: 2,
    operations: [
      { type: "replace_text", element_id: "responsive_text", text: "Updated text" },
      { type: "update_fill", element_id: "responsive_image", asset_type: "image", asset_id: "asset_22", alt_text: "Updated visual" }
    ]
  });
  assert.equal(allowed.length, 2);
  assert.throws(() => validateCanvaEditingOperations({
    pages,
    pageIndex: 2,
    operations: [{ type: "format_text", element_id: "responsive_text", formatting: { font_size: 32 } }]
  }), /responsive Canva page/i);
  assert.throws(() => validateCanvaEditingOperations({
    pages,
    pageIndex: 2,
    operations: [{ type: "position_element", element_id: "responsive_text", top: 10, left: 20 }]
  }), /responsive Canva page/i);
});

test("rejects invalid operations, element IDs, unsafe links, and non-editable pages", () => {
  assert.throws(() => validateCanvaEditingOperations({
    pages, pageIndex: 1, operations: [{ type: "run_script", source: "..." }]
  }), /unsupported/i);
  assert.throws(() => validateCanvaEditingOperations({
    pages, pageIndex: 1, operations: [{ type: "delete_element", element_id: "../bad" }]
  }), /valid Canva element ID/i);
  assert.throws(() => validateCanvaEditingOperations({
    pages, pageIndex: 1, operations: [{ type: "format_text", element_id: "txt_1", formatting: { link: "javascript:alert(1)" } }]
  }), /HTTPS URL/i);
  assert.throws(() => validateCanvaEditingOperations({
    pages: [{ ...pages[0], is_editable: false }], pageIndex: 1,
    operations: [{ type: "replace_text", element_id: "txt_1", text: "No" }]
  }), /not editable/i);
});

test("page restructuring requires confirmation and validates page references", () => {
  assert.throws(() => validateCanvaPageMerge({
    type: "modify_existing_design", designId: "DA123456789", operations: [{ type: "delete_pages", page_numbers: [2] }]
  }), /confirm/i);
  const request = validateCanvaPageMerge({
    type: "modify_existing_design",
    designId: "DA123456789",
    confirmed: true,
    operations: [
      { type: "move_pages", from_page_numbers: [3, 4], to_after_page_number: 1 },
      { type: "delete_pages", page_numbers: [5] }
    ]
  });
  assert.equal(request.operations.length, 2);
  assert.throws(() => validateCanvaPageMerge({
    type: "modify_existing_design", designId: "DA123456789", confirmed: true,
    operations: [{ type: "delete_pages", page_numbers: [0] }]
  }), /between 1 and 500/i);
});
