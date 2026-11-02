package com.priyanshuraj.jarviscompanion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Durable, privacy-minimized progress for on-device action sequences.
 *
 * Only generic action categories and step states are stored. Screen text,
 * app content, entered text, URLs, credentials and full action plans are not.
 * Interrupted device plans are never replayed automatically: their original
 * inputs are intentionally not persisted, so the user must review/reissue them.
 */
data class LocalTaskExecutionRecord(
    val id: String,
    val status: String,
    val actionKinds: List<String>,
    val stepStatuses: List<String>,
    val currentStepIndex: Int,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
    val requiresManualReplan: Boolean
)

object LocalTaskExecutionJournal {
    private const val PREFS = "jarvis_companion_task_journal"
    private const val KEY_RECORDS = "records"
    private const val MAX_RECORDS = 20
    private const val MAX_STEPS = 6

    private val allowedKinds = setOf(
        "open app", "read screen", "tap label", "type text",
        "scroll down", "scroll up", "back", "home", "ask user", "finish"
    )

    @Synchronized
    fun start(context: Context, actionKinds: List<String>): String {
        require(actionKinds.size in 1..MAX_STEPS) { "A task must contain between one and six actions." }
        require(actionKinds.all { it in allowedKinds }) { "The task contains an unsupported action category." }

        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        val record = JSONObject()
            .put("id", id)
            .put("status", "running")
            .put("actionKinds", JSONArray(actionKinds))
            .put("stepStatuses", JSONArray(List(actionKinds.size) { "pending" }))
            .put("currentStepIndex", 0)
            .put("createdAtEpochMs", now)
            .put("updatedAtEpochMs", now)
            .put("requiresManualReplan", false)

        val records = readJson(context)
        records.put(record)
        trim(records)
        writeJson(context, records)
        LocalActivityLog.record(context, "Device task started", actionKinds.size.toString() + " steps · " + actionKinds.joinToString(" → "))
        return id
    }

    @Synchronized
    fun checkpoint(
        context: Context,
        id: String,
        stepIndex: Int,
        success: Boolean,
        shouldStop: Boolean
    ): LocalTaskExecutionRecord? {
        val records = readJson(context)
        val record = find(records, id) ?: return null
        val states = record.optJSONArray("stepStatuses") ?: JSONArray()
        if (stepIndex !in 0 until states.length()) return record.toRecord()

        val stepStatus = when {
            !success -> "failed"
            shouldStop -> "waiting_user"
            else -> "completed"
        }
        states.put(stepIndex, stepStatus)
        val now = System.currentTimeMillis()
        record.put("stepStatuses", states)
            .put("currentStepIndex", if (success) stepIndex + 1 else stepIndex)
            .put("updatedAtEpochMs", now)

        val allCompleted = (0 until states.length()).all { states.optString(it) == "completed" }
        val status = when {
            !success -> "failed"
            shouldStop -> "waiting_user"
            allCompleted -> "completed"
            else -> "running"
        }
        record.put("status", status)
        writeJson(context, records)
        LocalActivityLog.record(
            context,
            "Device task checkpoint",
            "Step " + (stepIndex + 1) + "/" + states.length() + " · " + stepStatus
        )
        return record.toRecord()
    }

    @Synchronized
    fun finish(context: Context, id: String, status: String): LocalTaskExecutionRecord? {
        require(status in setOf("completed", "failed", "waiting_user", "cancelled")) {
            "Unsupported terminal task status."
        }
        val records = readJson(context)
        val record = find(records, id) ?: return null
        record.put("status", status)
            .put("updatedAtEpochMs", System.currentTimeMillis())
        writeJson(context, records)
        LocalActivityLog.record(context, "Device task " + status.replace('_', ' '), "Task " + status.replace('_', ' ') + ".")
        return record.toRecord()
    }

    /** Marks previously running sequences as interrupted without replaying any action. */
    @Synchronized
    fun recoverInterrupted(context: Context): List<LocalTaskExecutionRecord> {
        val records = readJson(context)
        val recovered = ArrayList<LocalTaskExecutionRecord>()
        var changed = false
        for (index in 0 until records.length()) {
            val record = records.optJSONObject(index) ?: continue
            if (record.optString("status") != "running") continue
            record.put("status", "interrupted")
                .put("requiresManualReplan", true)
                .put("updatedAtEpochMs", System.currentTimeMillis())
            recovered.add(record.toRecord())
            changed = true
            LocalActivityLog.record(
                context,
                "Device task interrupted",
                "The app restarted. Progress was saved; actions were not replayed. Review and reissue the task."
            )
        }
        if (changed) writeJson(context, records)
        return recovered
    }

    @Synchronized
    fun history(context: Context): List<LocalTaskExecutionRecord> {
        val records = readJson(context)
        return (records.length() - 1 downTo 0).mapNotNull { records.optJSONObject(it)?.toRecord() }
    }

    @Synchronized
    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_RECORDS)
            .apply()
    }

    private fun readJson(context: Context): JSONArray {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_RECORDS, "[]") ?: "[]"
        return runCatching { JSONArray(raw) }.getOrDefault(JSONArray())
    }

    private fun writeJson(context: Context, records: JSONArray) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_RECORDS, records.toString())
            .apply()
    }

    private fun find(records: JSONArray, id: String): JSONObject? {
        for (index in 0 until records.length()) {
            val item = records.optJSONObject(index) ?: continue
            if (item.optString("id") == id) return item
        }
        return null
    }

    private fun trim(records: JSONArray) {
        while (records.length() > MAX_RECORDS) records.remove(0)
    }

    private fun JSONObject.toRecord(): LocalTaskExecutionRecord {
        val kinds = optJSONArray("actionKinds") ?: JSONArray()
        val states = optJSONArray("stepStatuses") ?: JSONArray()
        return LocalTaskExecutionRecord(
            id = optString("id"),
            status = optString("status"),
            actionKinds = (0 until kinds.length()).map { kinds.optString(it) },
            stepStatuses = (0 until states.length()).map { states.optString(it) },
            currentStepIndex = optInt("currentStepIndex", 0).coerceIn(0, MAX_STEPS),
            createdAtEpochMs = optLong("createdAtEpochMs", 0L).coerceAtLeast(0L),
            updatedAtEpochMs = optLong("updatedAtEpochMs", 0L).coerceAtLeast(0L),
            requiresManualReplan = optBoolean("requiresManualReplan", false)
        )
    }
}
