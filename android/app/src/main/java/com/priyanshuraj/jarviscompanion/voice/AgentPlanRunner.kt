package com.priyanshuraj.jarviscompanion.voice

import android.content.Context
import android.os.Handler
import com.priyanshuraj.jarviscompanion.LocalTaskExecutionJournal
import org.json.JSONArray
import org.json.JSONObject

object AgentPlanRunner {
    private val allowed = setOf(
        "open_app", "read_screen", "tap_label", "type_text",
        "scroll_down", "scroll_up", "back", "home", "ask_user", "finish"
    )
    private val blockedLabel = Regex(
        "\\b(send|submit|delete|remove|pay|payment|purchase|buy|transfer|confirm|otp|one.?time|password|passcode|pin|verification|checkout|order|uninstall|grant|allow|deny|revoke)\\b",
        RegexOption.IGNORE_CASE
    )
    private val blockedTypedText = Regex(
        "\\b(password|passcode|otp|one.?time.?code|pin|cvv|security.?code|bank.?account|card.?number|payment|transfer|delete|submit|send)\\b",
        RegexOption.IGNORE_CASE
    )
    private val numericSecret = Regex("^\\d{4,10}$")

    /**
     * Validate every action on-device before the plan is previewed or executed.
     * This is a conservative allow-list, not a guarantee that an app's UI is safe.
     */
    fun validate(plan: JSONObject): JSONArray {
        val actions = plan.optJSONArray("actions")
            ?: throw IllegalArgumentException("The plan contains no action list.")
        if (actions.length() !in 1..6) {
            throw IllegalArgumentException("The plan must contain between one and six actions.")
        }

        for (index in 0 until actions.length()) {
            val action = actions.optJSONObject(index)
                ?: throw IllegalArgumentException("The plan contains an invalid action.")
            val type = action.optString("type")
            val value = action.optString("value").trim()
            if (type !in allowed || value.length > 180) {
                throw IllegalArgumentException("The plan contains an unsupported action.")
            }
            if (type in setOf("open_app", "tap_label", "type_text", "ask_user", "finish") && value.isBlank()) {
                throw IllegalArgumentException("A required action value is missing.")
            }
            if (type == "tap_label" && blockedLabel.containsMatchIn(value)) {
                throw IllegalArgumentException("The plan contains a protected screen control.")
            }
            if (type == "type_text" && (
                value.length > 160 ||
                numericSecret.matches(value) ||
                blockedTypedText.containsMatchIn(value)
            )) {
                throw IllegalArgumentException("The requested text is outside the safe typing policy.")
            }
            if (type == "open_app" && value.length > 60) {
                throw IllegalArgumentException("The requested app name is too long.")
            }
        }
        return actions
    }

    /** Describe exact planned actions before execution; typed text is previewed aloud. */
    fun describe(plan: JSONObject): String {
        val actions = validate(plan)
        val descriptions = ArrayList<String>()
        for (index in 0 until actions.length()) {
            val action = actions.getJSONObject(index)
            val type = action.optString("type")
            val value = action.optString("value").trim()
            val description = when (type) {
                "open_app" -> "Open " + value.take(40)
                "read_screen" -> "Read the visible screen locally"
                "tap_label" -> "Tap the visible control " + value.take(30)
                "type_text" -> "Enter this text into the field you focused: " + value.take(160)
                "scroll_down" -> "Scroll down"
                "scroll_up" -> "Scroll up"
                "back" -> "Go back"
                "home" -> "Go to the home screen"
                "ask_user" -> "Ask you: " + value.take(60)
                "finish" -> "Finish"
                else -> "Unsupported action"
            }
            descriptions.add((index + 1).toString() + ". " + description)
        }
        val intro = plan.optString("reply").trim().take(120)
        val actionsText = descriptions.joinToString(". ").take(520)
        return if (intro.isBlank()) actionsText else intro + ". " + actionsText
    }

    /** Generic categories only: do not persist app names, labels, queries, or typed text. */
    fun actionKinds(plan: JSONObject): String {
        val actions = validate(plan)
        val labels = ArrayList<String>()
        for (index in 0 until actions.length()) {
            val type = actions.getJSONObject(index).optString("type")
            labels.add(
                when (type) {
                    "open_app" -> "open app"
                    "read_screen" -> "read screen"
                    "tap_label" -> "tap label"
                    "type_text" -> "type text"
                    "scroll_down" -> "scroll down"
                    "scroll_up" -> "scroll up"
                    "back" -> "back"
                    "home" -> "home"
                    "ask_user" -> "ask user"
                    "finish" -> "finish"
                    else -> "unknown"
                }
            )
        }
        return labels.joinToString(" → ")
    }

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
        val actions = try {
            validate(plan)
        } catch (error: Exception) {
            onComplete(error.message ?: "JARVIS rejected an invalid action plan.")
            return {}
        }

        val steps = (0 until actions.length()).map { actions.optJSONObject(it) }
        val intro = plan.optString("reply").trim()
        val initialMessages = if (intro.isBlank()) emptyList() else listOf(intro.take(180))
        val taskKinds = actionKinds(plan).split(" → ")
        val journalId = try {
            LocalTaskExecutionJournal.start(context, taskKinds)
        } catch (error: Exception) {
            onComplete(error.message ?: "JARVIS could not save task progress. No Android actions were started.")
            return {}
        }

        val sequence = CancellableActionSequence(
            actions = steps,
            scheduler = HandlerTaskScheduler(handler),
            executeAction = { action ->
                if (action == null) {
                    TaskStepResult(false, true, "JARVIS stopped because the plan contained an invalid action.")
                } else {
                    val type = action.optString("type")
                    val value = action.optString("value")
                    val result = LocalCommandProcessor.executePlannedAction(context, type, value)
                    TaskStepResult(result.success, result.shouldStop, result.message)
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
            onProgress = { index, result ->
                runCatching {
                    LocalTaskExecutionJournal.checkpoint(
                        context, journalId, index, result.success, result.shouldStop
                    )
                }
            },
            onTerminal = { status ->
                runCatching { LocalTaskExecutionJournal.finish(context, journalId, status) }
            },
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
