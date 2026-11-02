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
        onState("running", index)
        scheduler.post(runner, 0L)
    }

    fun pause() {
        if (cancelled || completed || paused) return
        paused = true
        scheduler.remove(runner)
        onState("paused", index)
    }

    fun resume() {
        if (cancelled || completed || !paused) return
        paused = false
        onState("running", index)
        scheduler.post(runner, 0L)
    }

    fun cancel() {
        if (cancelled || completed) return
        cancelled = true
        paused = false
        scheduler.remove(runner)
        onState("cancelled", index)
        onTerminal("cancelled")
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
        onProgress(index, result)
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
        onTerminal(status)
        onComplete(messages.toList())
    }
}
