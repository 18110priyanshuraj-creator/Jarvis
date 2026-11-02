package com.priyanshuraj.jarviscompanion.voice

import android.content.Context
import android.os.Handler
import com.priyanshuraj.jarviscompanion.LocalTaskExecutionJournal
import com.priyanshuraj.jarviscompanion.accessibility.JarvisAccessibilityService
import com.priyanshuraj.jarviscompanion.accessibility.UiActionPolicy
import org.json.JSONArray
import org.json.JSONObject

data class AgentPlanControls(
    val cancel: () -> Unit,
    val pause: () -> Unit,
    val resume: () -> Unit
)

enum class AgentPlanMode {
    DEVICE_ACTION,
    CONVERSATION,
    CLARIFICATION
}

/** Process-wide gate shared by orb, one-shot voice and hands-free task execution. */
object AgentPlanExecutionGate {
    private var activeExecutionId: String? = null

    @Synchronized
    fun isBusy(): Boolean = activeExecutionId != null

    @Synchronized
    fun acquire(executionId: String): Boolean {
        require(executionId.isNotBlank()) { "An execution ID is required." }
        if (activeExecutionId != null) return false
        activeExecutionId = executionId
        return true
    }

    @Synchronized
    fun release(executionId: String) {
        if (activeExecutionId == executionId) activeExecutionId = null
    }

    @Synchronized
    fun activeIdForTests(): String? = activeExecutionId
}

object AgentPlanRunner {
    private val allowed = setOf(
        "open_app", "verify_app_foreground", "open_web_search", "verify_browser_foreground", "read_screen", "tap_label", "type_text",
        "scroll_down", "scroll_up", "back", "home", "verify_screen_text", "ask_user", "finish"
    )

    /**
     * Validate every action on-device before the plan is previewed or executed.
     * This is a conservative allow-list, not a guarantee that an app's UI is safe.
     */
    fun mode(plan: JSONObject): AgentPlanMode {
        return when (plan.optString("mode")) {
            "device_action" -> {
                validate(plan)
                AgentPlanMode.DEVICE_ACTION
            }
            "conversation" -> {
                requireNoDeviceActions(plan)
                AgentPlanMode.CONVERSATION
            }
            "clarification" -> {
                requireNoDeviceActions(plan)
                AgentPlanMode.CLARIFICATION
            }
            else -> throw IllegalArgumentException("The plan contains an unsupported request mode.")
        }
    }

    private fun requireNoDeviceActions(plan: JSONObject) {
        val actions = plan.optJSONArray("actions")
        if (actions != null && actions.length() > 0) {
            throw IllegalArgumentException("Conversation and clarification plans cannot contain device actions.")
        }
    }

    fun requiresAccessibility(plan: JSONObject): Boolean {
        val actions = validate(plan)
        val accessibilityActions = setOf(
            "verify_app_foreground", "verify_browser_foreground", "read_screen", "tap_label", "type_text",
            "scroll_down", "scroll_up", "back", "home", "verify_screen_text"
        )
        return (0 until actions.length()).any { index ->
            actions.getJSONObject(index).optString("type") in accessibilityActions
        }
    }

    fun executionBlockReason(plan: JSONObject): String? =
        if (requiresAccessibility(plan) && JarvisAccessibilityService.activeService == null) {
            "This task needs the JARVIS screen assistant. Enable it manually in Android Accessibility settings; no action has been started."
        } else null

    fun validate(plan: JSONObject): JSONArray {
        if (plan.optString("mode") != "device_action") {
            throw IllegalArgumentException("Only device-action plans can be executed on Android.")
        }
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
            if (type in setOf("open_app", "verify_app_foreground", "open_web_search", "verify_browser_foreground", "tap_label", "type_text", "verify_screen_text", "ask_user", "finish") && value.isBlank()) {
                throw IllegalArgumentException("A required action value is missing.")
            }
            if (type == "tap_label" && UiActionPolicy.isProtectedControl(value)) {
                throw IllegalArgumentException("The plan contains a protected screen control.")
            }
            if (type == "type_text" && !UiActionPolicy.validateTextPayload(value, 160).allowed) {
                throw IllegalArgumentException("The requested text is outside the safe typing policy.")
            }
            if (type in setOf("open_app", "verify_app_foreground") && value.length > 60) {
                throw IllegalArgumentException("The requested app name is too long.")
            }
            if (type == "open_web_search" &&
                (!UiActionPolicy.validateTextPayload(value, 120).allowed ||
                    Regex("""(?i)\b(porn|xxx|adult content|vape|cigarette|tobacco|nicotine|alcohol|liquor|beer|wine|weed|marijuana|cannabis|cocaine|methamphetamine|steroids|gambling|sports betting|casino|firearms?|weapons?|ammunition|how to make a bomb|explosives?|gun|suicide|self.?harm)\b""")
                        .containsMatchIn(value))
            ) {
                throw IllegalArgumentException("The Google search phrase is outside the safe research policy.")
            }
            if (type == "verify_browser_foreground" &&
                (!UiActionPolicy.validateTextPayload(value, 120).allowed ||
                    Regex("""(?i)\b(porn|xxx|adult content|vape|cigarette|tobacco|nicotine|alcohol|liquor|beer|wine|weed|marijuana|cannabis|cocaine|methamphetamine|steroids|gambling|sports betting|casino|firearms?|weapons?|ammunition|how to make a bomb|explosives?|gun|suicide|self.?harm)\b""")
                        .containsMatchIn(value))
            ) {
                throw IllegalArgumentException("The browser verification value is outside the safe research policy.")
            }
            if (type == "verify_screen_text" &&
                !UiActionPolicy.validateTextPayload(value, 160).allowed
            ) {
                throw IllegalArgumentException("The expected visible result is outside the safe verification policy.")
            }
        }

        // A public Google search must be followed by a matching browser foreground check.
        for (index in 0 until actions.length()) {
            val action = actions.getJSONObject(index)
            val type = action.optString("type")
            if (type == "open_web_search") {
                val verifier = actions.optJSONObject(index + 1)
                if (verifier?.optString("type") != "verify_browser_foreground" ||
                    verifier.optString("value") != action.optString("value")
                ) {
                    throw IllegalArgumentException("Every Google search launch must be followed by a matching browser foreground check.")
                }
            }
            if (type == "verify_browser_foreground") {
                val previous = actions.optJSONObject(index - 1)
                if (previous?.optString("type") != "open_web_search" ||
                    previous.optString("value") != action.optString("value")
                ) {
                    throw IllegalArgumentException("Browser foreground verification must immediately follow its matching Google search launch.")
                }
            }
        }

        // Every app launch must be followed immediately by a foreground-package check.
        for (index in 0 until actions.length()) {
            val action = actions.getJSONObject(index)
            val type = action.optString("type")
            if (type == "open_app") {
                val verifier = actions.optJSONObject(index + 1)
                if (verifier?.optString("type") != "verify_app_foreground" ||
                    UiActionPolicy.normalizeLabel(verifier.optString("value")) !=
                    UiActionPolicy.normalizeLabel(action.optString("value"))
                ) {
                    throw IllegalArgumentException("Every app launch must be followed by a matching foreground-app verification.")
                }
            }
            if (type == "verify_app_foreground") {
                val previous = actions.optJSONObject(index - 1)
                if (previous?.optString("type") != "open_app" ||
                    UiActionPolicy.normalizeLabel(previous.optString("value")) !=
                    UiActionPolicy.normalizeLabel(action.optString("value"))
                ) {
                    throw IllegalArgumentException("Foreground-app verification must immediately follow its matching app launch.")
                }
            }
        }

        // UI mutations need an explicit expected visible result after the last mutation.
        val lastUiMutation = (0 until actions.length()).lastOrNull { index ->
            actions.getJSONObject(index).optString("type") in setOf(
                "tap_label", "type_text", "scroll_down", "scroll_up", "back", "home"
            )
        } ?: -1
        if (lastUiMutation >= 0) {
            val hasResultCheck = (lastUiMutation + 1 until actions.length()).any { index ->
                actions.getJSONObject(index).optString("type") == "verify_screen_text"
            }
            if (!hasResultCheck) {
                throw IllegalArgumentException("UI actions need an expected visible-text verification before the plan can finish.")
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
                "verify_app_foreground" -> "Verify that " + value.take(40) + " is the foreground app"
                "open_web_search" -> "Open Google search for " + value.take(100)
                "verify_browser_foreground" -> "Verify the browser app is in the foreground"
                "read_screen" -> "Read the visible screen locally"
                "tap_label" -> "Tap the visible control " + value.take(30)
                "type_text" -> "Enter this text into the field you focused: " + value.take(160)
                "scroll_down" -> "Scroll down"
                "scroll_up" -> "Scroll up"
                "back" -> "Go back"
                "home" -> "Go to the home screen"
                "verify_screen_text" -> "Verify that this text is visible: " + value.take(100)
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
                    "verify_app_foreground" -> "verify app"
                    "open_web_search" -> "open web search"
                    "verify_browser_foreground" -> "verify browser"
                    "read_screen" -> "read screen"
                    "tap_label" -> "tap label"
                    "type_text" -> "type text"
                    "scroll_down" -> "scroll down"
                    "scroll_up" -> "scroll up"
                    "back" -> "back"
                    "home" -> "home"
                    "verify_screen_text" -> "verify screen"
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
     * Returns pause, resume and cancellation controls for the active sequence.
     */
    fun execute(
        context: Context,
        plan: JSONObject,
        handler: Handler,
        onProgress: (Int, Boolean) -> Unit = { _, _ -> },
        onComplete: (String) -> Unit
    ): AgentPlanControls? {
        val actions = try {
            validate(plan)
        } catch (error: Exception) {
            onComplete(error.message ?: "JARVIS rejected an invalid action plan.")
            return null
        }

        val blockedReason = executionBlockReason(plan)
        if (blockedReason != null) {
            onComplete(blockedReason)
            return null
        }
        if (AgentPlanExecutionGate.isBusy()) {
            onComplete("Another Android task is already active. Finish, pause or cancel it before starting another task.")
            return null
        }

        val steps = (0 until actions.length()).map { actions.optJSONObject(it) }
        val intro = plan.optString("reply").trim()
        val initialMessages = if (intro.isBlank()) emptyList() else listOf(intro.take(180))
        val taskKinds = actionKinds(plan).split(" → ")
        val journalId = try {
            LocalTaskExecutionJournal.start(context, taskKinds)
        } catch (error: Exception) {
            onComplete(error.message ?: "JARVIS could not save task progress. No Android actions were started.")
            return null
        }

        if (!AgentPlanExecutionGate.acquire(journalId)) {
            LocalTaskExecutionJournal.finish(context, journalId, "cancelled")
            onComplete("Another Android task started first. No action from this plan was run.")
            return null
        }

        var completedDuringStart = false
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
                    "open_web_search" -> 1800L
                    "tap_label" -> 600L
                    "back", "home" -> 700L
                    else -> 300L
                }
            },
            initialMessages = initialMessages,
            onState = { status, index ->
                if (status == "running" || status == "paused") {
                    LocalTaskExecutionJournal.setState(context, journalId, status, index)
                }
            },
            onProgress = { index, result ->
                LocalTaskExecutionJournal.checkpoint(
                    context, journalId, index, result.success, result.shouldStop
                )
                onProgress(index, result.success)
            },
            onTerminal = { status ->
                try {
                    LocalTaskExecutionJournal.finish(context, journalId, status)
                } finally {
                    AgentPlanExecutionGate.release(journalId)
                }
            },
            onComplete = { messages ->
                completedDuringStart = true
                onComplete(messages.joinToString(". ").take(1200))
            }
        )

        sequence.start()
        // A failed initial durable checkpoint can finish synchronously inside start().
        // Do not return stale controls for an execution that is already terminal.
        if (completedDuringStart) return null
        return AgentPlanControls(
            cancel = { sequence.cancel() },
            pause = { sequence.pause() },
            resume = { sequence.resume() }
        )
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
