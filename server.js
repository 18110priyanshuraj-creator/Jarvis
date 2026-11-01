      configured: gemini.configured,
      model: gemini.model,
      modelValid: gemini.modelValid,
      requestTimeoutMs: gemini.requestTimeoutMs,
      retryAttempts: gemini.retryAttempts
    },
    runtimeStorage: runtimeStore.mode()
  });
});

app.post("/api/login", loginLimiter, async (req, res) => {
  const candidate = cleanText(req.body?.password, 500);
  if (!PASSWORD || !candidate || !passwordsMatch(candidate, PASSWORD)) {
    return res.status(401).json({ error: "Incorrect password or server password is not configured." });
  }
  const token = crypto.randomBytes(32).toString("base64url");
  try {
    await runtimeStore.createSession(token, SESSION_TTL_MS);
  } catch (error) {
    console.error("Session creation failed:", error?.name || "Error");
    return res.status(503).json({ error: "Authentication is temporarily unavailable. Please try again." });
  }
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post("/api/logout", requireAuth, async (req, res) => {
  clearSessionCookie(res);
  try {
    await runtimeStore.deleteSession(req.sessionToken);
    res.json({ ok: true });
  } catch (error) {
    console.error("Session cleanup failed:", error?.name || "Error");
    res.status(503).json({ error: "The session was signed out locally, but server cleanup could not be confirmed." });
  }
});