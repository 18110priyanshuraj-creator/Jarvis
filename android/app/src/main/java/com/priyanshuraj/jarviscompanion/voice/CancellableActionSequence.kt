package com.priyanshuraj.jarviscompanion.voice

/** A small scheduler abstraction keeps the task sequence deterministic in JVM tests. */
internal interface TaskScheduler {
    fun post(task: Runnable, delayMs: Long)
    fun remove(task: Runnable)
}

internal data class TaskStepResult(
    val success: Boolean,
    val shouldStop: Boolean,
    val message: String
)

/**
 * Runs at most six actions in order. Cancellation removes the queued continuation
 * and guarantees that a cancelled sequence never invokes its completion callback.
 *
 * All methods are called on the scheduler's thread (the Android main thread in production).
 */
internal class CancellableActionSequence<T>(
    private val actions: List<T>,
    private val scheduler: TaskScheduler,
    private val executeAction: (T) -> TaskStepResult,
    private val delayAfter: (T) -> Long,
    initialMessages: List<String> = emptyList(),
    private val onState: (String, Int) -> Unit = { _, _ -> },
    private val onProgress: (Int, TaskStepResult) -> Unit = { _, _ -> },
    private val onTerminal: (String) -> Unit = {},
    private val onComplete: (List<String>) -> Unit
) {
    private val messages = initialMessages.toMutableList()
    private var index = 0
    private var cancelled = false
    private var paused = false
    private var completed = false

    private val runner = Runnable { runNext() }

    init {
        require(actions.size in 1..6) { "A task sequence must contain between one and six actions." }
    }

    fun start() {
        if (cancelled || completed || paused) return
        if (!persistState("running")) return
        scheduler.post(runner, 0L)
    }

    fun pause() {
        if (cancelled || completed || paused) return
        scheduler.remove(runner)
        if (!persistState("paused")) return
        paused = true
    }

    fun resume() {
        if (cancelled || completed || !paused) return
        if (!persistState("running")) return
        paused = false
        scheduler.post(runner, 0L)
    }

    private fun persistState(state: String): Boolean {
        return try {
            onState(state, index)
            true
        } catch (error: Exception) {
            failCheckpoint(error)
            false
        }
    }

    private fun failCheckpoint(error: Exception) {
        if (cancelled || completed) return
        completed = true
        scheduler.remove(runner)
        runCatching { onTerminal("failed") }
        val detail = error.message?.take(160) ?: "The task progress could not be saved."
        onComplete(messages.toList() + "Task paused safely: $detail No further actions were run.")
    }

    fun cancel() {
        if (cancelled || completed) return
        cancelled = true
        paused = false
        scheduler.remove(runner)
        runCatching { onState("cancelled", index) }
        runCatching { onTerminal("cancelled") }
    }

    private fun runNext() {
        if (cancelled || completed || paused) return
        if (index >= actions.size) {
            finish("completed")
            return
        }

        val action = actions[index]
        val result = try {
            executeAction(action)
        } catch (error: Exception) {
            TaskStepResult(
                success = false,
                shouldStop = true,
                message = error.message?.take(380) ?: "The action failed unexpectedly."
            )
        }
        try {
            onProgress(index, result)
        } catch (error: Exception) {
            if (result.message.isNotBlank()) messages.add(result.message.take(380))
            failCheckpoint(error)
            return
        }
        if (result.message.isNotBlank()) messages.add(result.message.take(380))
        index++

        if (!result.success) {
            finish("failed")
            return
        }
        if (result.shouldStop) {
            finish("waiting_user")
            return
        }
        if (index >= actions.size) {
            finish("completed")
            return
        }

        scheduler.post(runner, delayAfter(action).coerceIn(0L, 3000L))
    }

    private fun finish(status: String) {
        if (cancelled || completed) return
        completed = true
        try {
            onTerminal(status)
            onComplete(messages.toList())
        } catch (error: Exception) {
            val detail = error.message?.take(160) ?: "The final task checkpoint could not be saved."
            onComplete(messages.toList() + "The actions ended, but JARVIS could not verify the final saved status: $detail")
        }
    }
}
