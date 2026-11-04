import { db } from "hatchable";

export const access = "admin";
export const methods = ["GET", "POST"];

export default async function (req, res) {
  const ownerId = String(req.member.id);

  if (req.method === "GET") {
    const result = await db.query(
      "SELECT id, title, description, priority, status, created_at, updated_at FROM jarvis_tasks WHERE owner_id = $1 ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 100",
      [ownerId]
    );
    return res.json({ tasks: result.rows });
  }

  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const priority = ["low", "normal", "high"].includes(req.body?.priority) ? req.body.priority : "normal";

  if (!title || title.length > 120 || description.length > 500) {
    return res.status(400).json({ error: "A task title is required (maximum 120 characters); details may be up to 500 characters." });
  }

  const result = await db.query(
    "INSERT INTO jarvis_tasks (owner_id, title, description, priority) VALUES ($1, $2, $3, $4) RETURNING id, title, description, priority, status, created_at, updated_at",
    [ownerId, title, description, priority]
  );
  return res.status(201).json({ task: result.rows[0] });
}