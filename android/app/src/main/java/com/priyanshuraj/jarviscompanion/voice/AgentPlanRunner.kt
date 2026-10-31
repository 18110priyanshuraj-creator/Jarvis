package com.priyanshuraj.jarviscompanion.voice

import android.content.Context
import org.json.JSONObject

object AgentPlanRunner {
    private val allowed = setOf(
        "open_app", "read_screen", "tap_label", "type_text",
        "scroll_down", "scroll_up", "back", "home", "ask_user", "finish"
    )

    fun execute(context: Context, plan: JSONObject): String {
        val actions = plan.optJSONArray("actions")
            ?: return "JARVIS received an invalid plan. Please repeat the command."
        if (actions.length() !in 1..6) {
            return "JARVIS refused an action plan outside the allowed size."
        }

        val messages = mutableListOf<String>()
        val intro = plan.optString("reply").trim()
        if (intro.isNotBlank()) messages.add(intro.take(220))

        for (index in 0 until actions.length()) {
            val action = actions.optJSONObject(index)
                ?: return "JARVIS stopped because the plan contained an invalid action."
            val type = action.optString("type")
            val value = action.optString("value")

            if (type !in allowed || value.length > 180) {
                messages.add("JARVIS blocked an unsupported action.")
                break
            }

            val result = LocalCommandProcessor.executePlannedAction(context, type, value)
            if (result.message.isNotBlank()) messages.add(result.message.take(420))
            if (!result.success || result.shouldStop) break
        }

        return messages.joinToString(". ").take(1200)
            .ifBlank { "JARVIS did not receive an executable action." }
    }
}
