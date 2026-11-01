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
     * Returns a cancellation function that removes the queued next action.
     */
    fun execute(
        context: Context,
        plan: JSONObject,
        handler: Handler,
        onComplete: (String) -> Unit
    ): () -> Unit {
        val actions = plan.optJSONArray("actions")
        if (actions == null || actions.length() !in 1..6) {
            onComplete("JARVIS received an invalid or oversized action plan.")
            return {}
        }

        val steps = (0 until actions.length()).map { actions.optJSONObject(it) }
        val intro = plan.optString("reply").trim()
        val initialMessages = if (intro.isBlank()) emptyList() else listOf(intro.take(180))

        val sequence = CancellableActionSequence(
            actions = steps,
            scheduler = HandlerTaskScheduler(handler),
            executeAction = { action ->
                if (action == null) {
                    TaskStepResult(false, true, "JARVIS stopped because the plan contained an invalid action.")
                } else {
                    val type = action.optString("type")
                    val value = action.optString("value")
                    if (type !in allowed || value.length > 180) {
                        TaskStepResult(false, true, "JARVIS blocked an unsupported action.")
                    } else {
                        val result = LocalCommandProcessor.executePlannedAction(context, type, value)
                        TaskStepResult(result.success, result.shouldStop, result.message)
                    }
                }
            },
            delayAfter = { action ->
                when (action?.optString("type")) {
                    "open_app" -> 1400L
                    "tap_label" -> 600L
                    "back", "home" -> 700L
                    else -> 300L
                }
            },
            initialMessages = initialMessages,
            onComplete = { messages ->
                onComplete(messages.joinToString(". ").take(1200))
            }
        )

        sequence.start()
        return { sequence.cancel() }
    }

    private class HandlerTaskScheduler(private val handler: Handler) : TaskScheduler {
        override fun post(task: Runnable, delayMs: Long) {
            if (delayMs <= 0L) handler.post(task) else handler.postDelayed(task, delayMs)
        }

        override fun remove(task: Runnable) {
            handler.removeCallbacks(task)
        }
    }
}
