import { db } from "hatchable";

export const access = "admin";
export const methods = ["GET", "POST"];

function looksSensitive(text) {
  return /(?:password|passwd|api[_ -]?key|secret|otp|one.time.password|private.key|bearer\s+[a-z0-9._-]{12,})/i.test(text);
}

export default async function (req, res) {
  const ownerId = String(req.member.id);

  if (req.method === "GET") {
    const result = await db.query(
      "SELECT id, title, content, category, created_at FROM jarvis_memories WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 100",
      [ownerId]
    );
    return res.json({ memories: result.rows });
  }

  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  const category = ["note", "preference", "goal", "fact"].includes(req.body?.category) ? req.body.category : "note";

  if (!title || title.length > 100 || !content || content.length > 1600) {
    return res.status(400).json({ error: "A title (up to 100 characters) and note (up to 1,600 characters) are required." });
  }
  if (looksSensitive(title + "\n" + content)) {
    return res.status(400).json({ error: "This note looks like it may contain a credential or secret. Do not save passwords, API keys, or authentication codes." });
  }

  const result = await db.query(
    "INSERT INTO jarvis_memories (owner_id, title, content, category) VALUES ($1, $2, $3, $4) RETURNING id, title, content, category, created_at",
    [ownerId, title, content, category]
  );
  return res.status(201).json({ memory: result.rows[0] });
}