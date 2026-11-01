import crypto from "node:crypto";

export const RUNTIME_CHAT_LIMIT = 32;
export const RUNTIME_CHAT_TTL_MS = 60 * 60 * 1000;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("base64url");
}

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeChatRow(row) {
  return {
    id: String(row.id),
    role: row.role === "assistant" ? "assistant" : "user",
    content: String(row.content ?? ""),
    ...(row.engine ? { engine: String(row.engine) } : {}),
    sources: parseJsonArray(row.sources),
    citations: parseJsonArray(row.citations),
    createdAt: new Date(timestamp(row.created_at)).toISOString()
  };
}

/**
 * Shared runtime state for deployments that use Neon. The in-memory adapter
 * remains available for local development and tests without DATABASE_URL.
 * Raw session identifiers and OAuth browser/session tokens are never stored.
 */
export function createRuntimeStore({ getSql = () => null, now = () => Date.now() } = {}) {
  const memorySessions = new Map();
  const memoryChats = new Map();
  const memoryOAuthStates = new Map();
  let schemaPromise = null;

  function currentSql() {
    return typeof getSql === "function" ? getSql() : null;
  }

  async function ensureTables() {
    const sql = currentSql();
    if (!sql) return null;
    if (!schemaPromise) {
      schemaPromise = (async () => {
        await sql`CREATE TABLE IF NOT EXISTS jarvis_sessions (
          token_hash TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
        await sql`CREATE INDEX IF NOT EXISTS jarvis_sessions_expiry_idx
          ON jarvis_sessions (expires_at)`;
        await sql`CREATE TABLE IF NOT EXISTS jarvis_chat_messages (
          id BIGSERIAL PRIMARY KEY,
          conversation_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          content TEXT NOT NULL,
          engine TEXT,
          sources JSONB NOT NULL DEFAULT '[]'::jsonb,
          citations JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        )`;
        await sql`CREATE INDEX IF NOT EXISTS jarvis_chat_messages_session_idx
          ON jarvis_chat_messages (conversation_hash, id DESC)`;
        await sql`CREATE INDEX IF NOT EXISTS jarvis_chat_messages_expiry_idx
          ON jarvis_chat_messages (expires_at)`;
        await sql`CREATE TABLE IF NOT EXISTS jarvis_oauth_pending (
          state_hash TEXT PRIMARY KEY,
          session_hash TEXT NOT NULL,
          browser_binding_hash TEXT NOT NULL,
          requested_scopes TEXT[] NOT NULL,
          capability TEXT NOT NULL,
          encrypted_verifier JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        )`;
        await sql`CREATE INDEX IF NOT EXISTS jarvis_oauth_pending_expiry_idx
          ON jarvis_oauth_pending (expires_at)`;
      })().catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }
    await schemaPromise;
    return sql;
  }

  async function createSession(token, ttlMs) {
    const sessionHash = sha256(token);
    const createdAt = now();
    const expiresAt = createdAt + ttlMs;
    const sql = await ensureTables();
    if (sql) {
      await sql`INSERT INTO jarvis_sessions
        (token_hash, created_at, expires_at, last_seen_at)
        VALUES (${sessionHash}, ${new Date(createdAt).toISOString()},
          ${new Date(expiresAt).toISOString()}, ${new Date(createdAt).toISOString()})
        ON CONFLICT (token_hash) DO UPDATE SET
          created_at = EXCLUDED.created_at,
          expires_at = EXCLUDED.expires_at,
          last_seen_at = EXCLUDED.last_seen_at`;
      return;
    }
    memorySessions.set(String(token), { createdAt, expiresAt });
  }

  async function refreshSessionByHash(sessionHash, ttlMs) {
    const sql = await ensureTables();
    const currentTime = now();
    if (sql) {
      const rows = await sql`UPDATE jarvis_sessions
        SET expires_at = ${new Date(currentTime + ttlMs).toISOString()},
            last_seen_at = ${new Date(currentTime).toISOString()}
        WHERE token_hash = ${String(sessionHash)}
          AND expires_at > now()
        RETURNING created_at, expires_at`;
      return rows.length > 0;
    }
    for (const [token, session] of memorySessions) {
      if (sha256(token) !== String(sessionHash)) continue;
      if (session.expiresAt <= currentTime) {
        memorySessions.delete(token);
        return false;
      }
      session.expiresAt = currentTime + ttlMs;
      return true;
    }
    return false;
  }

  async function refreshSession(token, ttlMs) {
    const sql = await ensureTables();
    const currentTime = now();
    if (sql) {
      const rows = await sql`UPDATE jarvis_sessions
        SET expires_at = ${new Date(currentTime + ttlMs).toISOString()},
            last_seen_at = ${new Date(currentTime).toISOString()}
        WHERE token_hash = ${sha256(token)}
          AND expires_at > now()
        RETURNING created_at, expires_at`;
      return rows.length > 0;
    }
    const session = memorySessions.get(String(token));
    if (!session || session.expiresAt <= currentTime) {
      memorySessions.delete(String(token));
      return false;
    }
    session.expiresAt = currentTime + ttlMs;
    return true;
  }

  async function deleteSession(token) {
    const sessionHash = sha256(token);
    const conversationHash = sha256("session:" + String(token));
    const sql = await ensureTables();
    if (sql) {
      await sql.transaction([
        sql`DELETE FROM jarvis_chat_messages WHERE conversation_hash = ${conversationHash}`,
        sql`DELETE FROM jarvis_oauth_pending WHERE session_hash = ${sessionHash}`,
        sql`DELETE FROM jarvis_sessions WHERE token_hash = ${sessionHash}`
      ]);
      return;
    }
    memorySessions.delete(String(token));
    memoryChats.delete("session:" + String(token));
    for (const [stateHash, pending] of memoryOAuthStates) {
      if (pending.sessionHash === sessionHash) memoryOAuthStates.delete(stateHash);
    }
  }

  async function getConversationMessages(key) {
    const conversationHash = sha256(key);
    const currentTime = now();
    const sql = await ensureTables();
    if (sql) {
      const expiresAt = new Date(currentTime + RUNTIME_CHAT_TTL_MS).toISOString();
      await sql`UPDATE jarvis_chat_messages
        SET expires_at = ${expiresAt}
        WHERE conversation_hash = ${conversationHash} AND expires_at > now()`;
      const rows = await sql`SELECT id, role, content, engine, sources, citations, created_at
        FROM jarvis_chat_messages
        WHERE conversation_hash = ${conversationHash} AND expires_at > now()
        ORDER BY id DESC LIMIT ${RUNTIME_CHAT_LIMIT}`;
      return rows.reverse().map(normalizeChatRow);
    }
    for (const [entryKey, entry] of memoryChats) {
      if (currentTime - entry.updatedAt > RUNTIME_CHAT_TTL_MS) memoryChats.delete(entryKey);
    }
    let entry = memoryChats.get(String(key));
    if (!entry) {
      entry = { messages: [], updatedAt: currentTime };
      memoryChats.set(String(key), entry);
    }
    entry.updatedAt = currentTime;
    return entry.messages;
  }

  async function appendConversationTurn(key, message, result) {
    const createdAt = now();
    const expiresAt = new Date(createdAt + RUNTIME_CHAT_TTL_MS).toISOString();
    const conversationHash = sha256(key);
    const assistantSources = Array.isArray(result.sources) ? result.sources : [];
    const assistantCitations = Array.isArray(result.citations) ? result.citations : [];
    const sql = await ensureTables();
    if (sql) {
      await sql.transaction([
        sql`INSERT INTO jarvis_chat_messages
          (conversation_hash, role, content, sources, citations, created_at, expires_at)
          VALUES (${conversationHash}, 'user', ${String(message)}, '[]'::jsonb, '[]'::jsonb,
            ${new Date(createdAt).toISOString()}, ${expiresAt})`,
        sql`INSERT INTO jarvis_chat_messages
          (conversation_hash, role, content, engine, sources, citations, created_at, expires_at)
          VALUES (${conversationHash}, 'assistant', ${String(result.answer ?? "")},
            ${result.engine ?? null}, ${JSON.stringify(assistantSources)}::jsonb,
            ${JSON.stringify(assistantCitations)}::jsonb,
            ${new Date(createdAt + 1).toISOString()}, ${expiresAt})`,
        sql`DELETE FROM jarvis_chat_messages
          WHERE conversation_hash = ${conversationHash}
            AND id NOT IN (
              SELECT id FROM jarvis_chat_messages
              WHERE conversation_hash = ${conversationHash}
              ORDER BY id DESC LIMIT ${RUNTIME_CHAT_LIMIT}
            )`,
        sql`DELETE FROM jarvis_chat_messages WHERE expires_at <= now()`
      ]);
      return;
    }
    const messages = await getConversationMessages(key);
    messages.push(
      { id: crypto.randomUUID(), role: "user", content: String(message), createdAt: new Date(createdAt).toISOString() },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: String(result.answer ?? ""),
        engine: result.engine,
        sources: assistantSources,
        citations: assistantCitations,
        createdAt: new Date(createdAt + 1).toISOString()
      }
    );
    if (messages.length > RUNTIME_CHAT_LIMIT) messages.splice(0, messages.length - RUNTIME_CHAT_LIMIT);
    const entry = memoryChats.get(String(key));
    if (entry) entry.updatedAt = createdAt;
  }

  async function deleteConversationMessages(key) {
    const sql = await ensureTables();
    if (sql) {
      await sql`DELETE FROM jarvis_chat_messages WHERE conversation_hash = ${sha256(key)}`;
      return;
    }
    memoryChats.delete(String(key));
  }

  async function savePendingOAuthState(stateHash, pending) {
    const sql = await ensureTables();
    if (sql) {
      await sql`DELETE FROM jarvis_oauth_pending WHERE expires_at <= now()`;
      await sql`INSERT INTO jarvis_oauth_pending
        (state_hash, session_hash, browser_binding_hash, requested_scopes, capability,
         encrypted_verifier, created_at, expires_at)
        VALUES (${String(stateHash)}, ${String(pending.sessionHash)},
          ${String(pending.browserBindingHash)}, ${pending.requestedScopes},
          ${String(pending.capability)}, ${JSON.stringify(pending.encryptedVerifier)}::jsonb,
          ${new Date(pending.createdAt).toISOString()}, ${new Date(pending.expiresAt).toISOString()})`;
      return;
    }
    memoryOAuthStates.set(String(stateHash), { ...pending });
  }

  async function consumePendingOAuthState(stateHash) {
    const sql = await ensureTables();
    if (sql) {
      const rows = await sql`DELETE FROM jarvis_oauth_pending
        WHERE state_hash = ${String(stateHash)} AND expires_at > now()
        RETURNING session_hash, browser_binding_hash, requested_scopes, capability,
          encrypted_verifier, created_at, expires_at`;
      if (!rows.length) {
        await sql`DELETE FROM jarvis_oauth_pending WHERE state_hash = ${String(stateHash)}`;
        return null;
      }
      const row = rows[0];
      return {
        sessionHash: String(row.session_hash),
        browserBindingHash: String(row.browser_binding_hash),
        requestedScopes: Array.isArray(row.requested_scopes) ? row.requested_scopes : [],
        capability: String(row.capability),
        encryptedVerifier: typeof row.encrypted_verifier === "string"
          ? JSON.parse(row.encrypted_verifier)
          : row.encrypted_verifier,
        createdAt: timestamp(row.created_at),
        expiresAt: timestamp(row.expires_at)
      };
    }
    const pending = memoryOAuthStates.get(String(stateHash));
    memoryOAuthStates.delete(String(stateHash));
    if (!pending || pending.expiresAt <= now()) return null;
    return pending;
  }

  return {
    ensureTables,
    createSession,
    refreshSession,
    refreshSessionByHash,
    deleteSession,
    getConversationMessages,
    appendConversationTurn,
    deleteConversationMessages,
    savePendingOAuthState,
    consumePendingOAuthState,
    hashIdentifier: sha256,
    mode: () => currentSql() ? "neon-postgresql" : "process-memory"
  };
}
