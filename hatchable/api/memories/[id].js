import { db } from "hatchable";

export const access = "admin";
export const methods = ["DELETE"];

export default async function (req, res) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid note id." });
  }

  const result = await db.query(
    "DELETE FROM jarvis_memories WHERE id = $1 AND owner_id = $2 RETURNING id",
    [id, String(req.member.id)]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Note not found." });
  return res.json({ deleted: true });
}