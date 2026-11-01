package com.priyanshuraj.jarviscompanion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Small, on-device-only activity history.
 *
 * Only event names, timestamps and generic action categories are saved.
 * Never pass transcripts, screen text, app content, or typed field values to record().
 */
object LocalActivityLog {
    private const val PREFS = "jarvis_companion_activity"
    private const val KEY_EVENTS = "events"
    private const val MAX_EVENTS = 30

    @Synchronized
    fun record(context: Context, event: String, detail: String) {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val current = try {
            JSONArray(preferences.getString(KEY_EVENTS, "[]") ?: "[]")
        } catch (_: Exception) {
            JSONArray()
        }

        val updated = JSONArray()
        updated.put(
            JSONObject()
                .put("at", System.currentTimeMillis())
                .put("event", event.trim().take(48))
                .put("detail", detail.trim().take(180))
        )

        val retained = minOf(current.length(), MAX_EVENTS - 1)
        for (index in 0 until retained) {
            val oldIndex = current.length() - 1 - index
            current.optJSONObject(oldIndex)?.let { updated.put(it) }
        }
        preferences.edit().putString(KEY_EVENTS, updated.toString()).apply()
    }

    fun render(context: Context): String {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_EVENTS, "[]") ?: "[]"
        val events = try {
            JSONArray(raw)
        } catch (_: Exception) {
            JSONArray()
        }
        if (events.length() == 0) return "No activity recorded yet."

        val formatter = SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault())
        val lines = ArrayList<String>()
        for (index in 0 until events.length()) {
            val item = events.optJSONObject(index) ?: continue
            val timestamp = item.optLong("at", 0L)
            val event = item.optString("event", "Activity")
            val detail = item.optString("detail", "")
            val time = if (timestamp > 0L) formatter.format(Date(timestamp)) else "Unknown time"
            lines.add(time + "  •  " + event + "\n" + detail)
        }
        return lines.joinToString("\n\n").ifBlank { "No activity recorded yet." }
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_EVENTS)
            .apply()
    }
}
