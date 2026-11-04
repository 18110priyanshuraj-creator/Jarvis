import { db } from "hatchable";

export const access = "admin";
export const methods = ["PATCH", "DELETE"];

export default async function (req, res) {
  const ownerId = String(req.member.id);
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid task id." });
  }

  if (req.method === "DELETE") {
    const removed = await db.query(
      "DELETE FROM jarvis_tasks WHERE id = $1 AND owner_id = $2 RETURNING id",
      [id, ownerId]
    );
    if (!removed.rows.length) return res.status(404).json({ error: "Task not found." });
    return res.json({ deleted: true });
  }

  const status = req.body?.status;
  if (!["open", "done"].includes(status)) {
    return res.status(400).json({ error: "Task status must be open or done." });
  }
  const result = await db.query(
    "UPDATE jarvis_tasks SET status = $1, updated_at = now() WHERE id = $2 AND owner_id = $3 RETURNING id, title, description, priority, status, created_at, updated_at",
    [status, id, ownerId]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Task not found." });
  return res.json({ task: result.rows[0] });
}