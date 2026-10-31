package com.priyanshuraj.jarviscompanion.voice

import android.content.Context
import android.os.Handler
import org.json.JSONObject

object AgentPlanRunner {
    private val allowed = setOf(
        "open_app", "read_screen", "tap_label", "type_text",
        "scroll_down", "scroll_up", "back", "home", "ask_user", "finish"
    )

    /**
     * Execute one small action at a time on the main thread.
     * App launches and screen transitions get time to settle before the next UI action.
     */
    fun execute(
        context: Context,
        plan: JSONObject,
        handler: Handler,
        onComplete: (String) -> Unit
    ) {
        val actions = plan.optJSONArray("actions")
        if (actions == null || actions.length() !in 1..6) {
            onComplete("JARVIS received an invalid or oversized action plan.")
            return
        }

        val messages = mutableListOf<String>()
        val intro = plan.optString("reply").trim()
        if (intro.isNotBlank()) messages.add(intro.take(180))
        var index = 0

        val runner = object : Runnable {
            override fun run() {
                if (index >= actions.length()) {
                    onComplete(messages.joinToString(". ").take(1200))
                    return
                }

                val action = actions.optJSONObject(index)
                if (action == null) {
                    messages.add("JARVIS stopped because the plan contained an invalid action.")
                    onComplete(messages.joinToString(". ").take(1200))
                    return
                }

                val type = action.optString("type")
                val value = action.optString("value")
                if (type !in allowed || value.length > 180) {
                    messages.add("JARVIS blocked an unsupported action.")
                    onComplete(messages.joinToString(". ").take(1200))
                    return
                }

                val result = LocalCommandProcessor.executePlannedAction(context, type, value)
                if (result.message.isNotBlank()) messages.add(result.message.take(380))
                index++

                if (!result.success || result.shouldStop || index >= actions.length()) {
                    onComplete(messages.joinToString(". ").take(1200))
                    return
                }

                val delay = when (type) {
                    "open_app" -> 1400L
                    "tap_label" -> 600L
                    "back", "home" -> 700L
                    else -> 300L
                }
                handler.postDelayed(this, delay)
            }
        }

        handler.post(runner)
    }
}
