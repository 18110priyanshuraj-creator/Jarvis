import { db } from "hatchable";

export const access = "admin";
export const methods = ["GET"];

export default async function (req, res) {
  try {
    await db.query("SELECT 1 AS ok");
    return res.json({
      ok: true,
      database: true,
      aiCapability: "declared",
      aiConfigured: null,
      access: "owner-only",
      chatPersistence: "browser-session"
    });
  } catch (error) {
    console.error("JARVIS health check failed:", error?.message || "database unavailable");
    return res.status(503).json({
      ok: false,
      database: false,
      aiCapability: "declared",
      aiConfigured: null,
      access: "owner-only"
    });
  }
}