import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPageReadToken,
  createWebPageRead,
  extractPageContent,
  getWebPageReadStatus,
  isPublicIpv4,
  normalizePublicPageUrl,
  readWebPage,
  verifyPageReadToken
} from "../services/web-page-reader.js";

const htmlPage = `<!doctype html>
<html><head><title>Energy &amp; Solar</title>
<meta name="description" content="An official guide to solar power.">
<script>window.secret = "must not appear";</script>
<style>.hidden { display:none }</style></head>
<body><nav>Navigation should not be shown</nav>
<main><h1>Solar energy</h1><p>Solar panels convert sunlight into electricity.</p>
<p>They can supply homes and buildings.</p></main><footer>Footer should not be shown</footer></body></html>`;

test("page reader only accepts public HTTPS URLs on port 443", () => {
  assert.equal(normalizePublicPageUrl("https://example.com/article#section").href, "https://example.com/article");
  for (const value of [
    "http://example.com",
    "https://user:pass@example.com/path",
    "https://example.com:8443/path",
    "https://localhost/admin",
    "https://router.local/",
    "https://service.internal/",
    "https://127.0.0.1/",
    "https://[::1]/"
  ]) assert.equal(normalizePublicPageUrl(value), null, value);
});

test("IPv4 public-address validation rejects loopback, private, link-local, reserved and multicast ranges", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) assert.equal(isPublicIpv4(ip), true, ip);
  for (const ip of [
    "0.0.0.1", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
    "172.16.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255"
  ]) assert.equal(isPublicIpv4(ip), false, ip);
});

test("page read tokens are bound to one source, one session and a short expiry", () => {
  const token = createPageReadToken("https://example.com/a#part", "session-one", "test-secret", 1000);
  assert.equal(typeof token, "string");
  assert.equal(verifyPageReadToken(token, "session-one", "test-secret", 2000), "https://example.com/a");
  assert.equal(verifyPageReadToken(token, "session-two", "test-secret", 2000), null);
  assert.equal(verifyPageReadToken(token, "session-one", "other-secret", 2000), null);
  assert.equal(verifyPageReadToken(token, "session-one", "test-secret", 901001), null);
  assert.equal(verifyPageReadToken(token, "session-one", "test-secret", 500), null);
  assert.equal(createPageReadToken("http://example.com", "session-one", "test-secret"), null);
});

test("HTML extraction keeps readable text and metadata while removing executable and navigation markup", () => {
  const result = extractPageContent(htmlPage, { url: "https://example.com/solar", contentType: "text/html", maxChars: 5000 });
  assert.equal(result.title, "Energy & Solar");
  assert.equal(result.description, "An official guide to solar power.");
  assert.match(result.text, /Solar panels convert sunlight into electricity/);
  assert.doesNotMatch(result.text, /window\.secret|display:none|Navigation should not be shown|Footer should not be shown/);
  assert.equal(result.truncated, false);
});

test("plain-text extraction is bounded and marked when truncated", () => {
  const result = extractPageContent("A\nB\nC", {
    url: "https://example.com/plain", contentType: "text/plain", maxChars: 3
  });
  assert.equal(result.text, "A\nB");
  assert.equal(result.truncated, true);
});

test("page reader pins a validated public IPv4 address and returns page metadata", async () => {
  let requested;
  const page = await readWebPage("https://example.com/solar", {
    resolveHostname: async (hostname, options) => {
      assert.equal(hostname, "example.com");
      assert.deepEqual(options, { all: true, verbatim: true, family: 4 });
      return [{ address: "93.184.216.34", family: 4 }];
    },
    requestPage: async (url, pinnedIp, timeoutMs, maxBytes) => {
      requested = { url: url.href, pinnedIp, timeoutMs, maxBytes };
      return {
        statusCode: 200,
        headers: { "content-type": "text/html; charset=utf-8", "content-length": String(Buffer.byteLength(htmlPage)) },
        body: Buffer.from(htmlPage)
      };
    }
  });
  assert.equal(requested.url, "https://example.com/solar");
  assert.equal(requested.pinnedIp, "93.184.216.34");
  assert.ok(requested.timeoutMs >= 3000);
  assert.ok(requested.maxBytes <= 2_000_000);
  assert.equal(page.title, "Energy & Solar");
  assert.equal(page.url, "https://example.com/solar");
  assert.match(page.text, /Solar panels convert sunlight into electricity/);
  assert.equal(page.contentType, "text/html");
  assert.ok(page.retrievedAt);
});

test("page reader blocks mixed public/private DNS answers before making a request", async () => {
  let requested = false;
  await assert.rejects(readWebPage("https://example.com/", {
    resolveHostname: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 }
    ],
    requestPage: async () => { requested = true; }
  }), error => error.code === "PAGE_ADDRESS_BLOCKED");
  assert.equal(requested, false);
});

test("page reader blocks redirects, non-text content and oversized bodies", async () => {
  const resolveHostname = async () => [{ address: "93.184.216.34", family: 4 }];
  const requestPage = async (_url, _ip, _timeout, maxBytes) => ({
    statusCode: 200,
    headers: { "content-type": "text/html", "content-length": String(maxBytes + 1) },
    body: Buffer.alloc(maxBytes + 1)
  });
  await assert.rejects(readWebPage("https://example.com/", {
    resolveHostname, requestPage
  }), error => error.code === "PAGE_RESPONSE_TOO_LARGE");

  await assert.rejects(readWebPage("https://example.com/", {
    resolveHostname,
    requestPage: async () => ({ statusCode: 302, headers: { location: "https://other.example/" }, body: "" })
  }), error => error.code === "PAGE_REDIRECT_BLOCKED");

  await assert.rejects(readWebPage("https://example.com/file.pdf", {
    resolveHostname,
    requestPage: async () => ({ statusCode: 200, headers: { "content-type": "application/pdf" }, body: "%PDF" })
  }), error => error.code === "PAGE_CONTENT_TYPE_BLOCKED");
});

test("page reader rejects empty pages and hides transport errors", async () => {
  const resolveHostname = async () => [{ address: "93.184.216.34", family: 4 }];
  await assert.rejects(readWebPage("https://example.com/empty", {
    resolveHostname,
    requestPage: async () => ({ statusCode: 200, headers: { "content-type": "text/html" }, body: "<html><body></body></html>" })
  }), error => error.code === "PAGE_TEXT_EMPTY");
  await assert.rejects(readWebPage("https://example.com/error", {
    resolveHostname,
    requestPage: async () => { throw new Error("internal host details and credentials"); }
  }), error => error.code === "PAGE_FETCH_FAILED" && !error.message.includes("credentials"));
});

test("page-reading status is off until explicitly enabled", () => {
  const previous = process.env.JARVIS_PAGE_READ_ENABLED;
  try {
    delete process.env.JARVIS_PAGE_READ_ENABLED;
    assert.equal(getWebPageReadStatus().enabled, false);
    process.env.JARVIS_PAGE_READ_ENABLED = "true";
    assert.equal(getWebPageReadStatus().enabled, true);
  } finally {
    if (previous === undefined) delete process.env.JARVIS_PAGE_READ_ENABLED;
    else process.env.JARVIS_PAGE_READ_ENABLED = previous;
  }
});

test("full-page read returns honest extracted-text fallback without an online AI provider", async () => {
  const previous = Object.fromEntries(["JARVIS_AI_BASE_URL", "JARVIS_AI_API_KEY", "JARVIS_AI_MODEL", "JARVIS_AI_ENABLED", "JARVIS_AI_CHAT_ENABLED"].map(key => [key, process.env[key]]));
  try {
    for (const key of Object.keys(previous)) delete process.env[key];
    const result = await createWebPageRead("https://example.com/solar", {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      requestPage: async () => ({
        statusCode: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from(htmlPage)
      })
    });
    assert.equal(result.externalPageRead, true);
    assert.equal(result.aiSynthesized, false);
    assert.equal(result.engine, "full-page-extraction");
    assert.match(result.page.text, /Solar panels convert sunlight into electricity/);
    assert.match(result.answer, /AI summary is not available/i);
    assert.deepEqual(result.citations, []);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
