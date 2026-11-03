const originalFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init = {}) => {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(requestUrl);
  const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();

  if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token" && method === "POST") {
    return new Response(JSON.stringify({
      access_token: "phase18-test-access-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: [
        "https://www.googleapis.com/auth/drive.metadata.readonly",
        "https://www.googleapis.com/auth/youtube.upload"
      ].join(" ")
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (url.hostname === "www.googleapis.com" && url.pathname === "/upload/youtube/v3/videos") {
    if (method === "POST" && url.searchParams.get("uploadType") === "resumable") {
      return new Response(null, {
        status: 200,
        headers: { Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=phase18-test-session" }
      });
    }
    if (method === "PUT" && url.searchParams.get("upload_id") === "phase18-test-session") {
      let receivedBytes = 0;
      for await (const chunk of init.body || []) {
        receivedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      }
      const expectedBytes = Number(init.headers?.["Content-Length"] || 0);
      if (receivedBytes !== expectedBytes) {
        return new Response(JSON.stringify({ error: { message: "Mock provider received an unexpected byte count." } }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({
        id: "phase18video01",
        snippet: { title: "Phase 18 route test" },
        status: { privacyStatus: "private", uploadStatus: "uploaded" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  }

  return originalFetch(input, init);
};
