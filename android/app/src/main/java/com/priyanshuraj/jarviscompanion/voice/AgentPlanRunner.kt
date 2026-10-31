package com.priyanshuraj.jarviscompanion.voice

import android.content.Context
import android.os.Handler
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

    /** Re-check the server's plan on-device before showing or running it. */
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

    /** Exact action preview; typed text is spoken locally so the user can check it. */
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

    /** Execute only after the user explicitly approves the reviewed plan. */
    fun execute(
        context: Context,
        plan: JSONObject,
        handler: Handler,
        onComplete: (String) -> Unit
    ) {
        val actions = try {
            validate(plan)
        } catch (error: Exception) {
            onComplete(error.message ?: "JARVIS rejected an invalid action plan.")
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
