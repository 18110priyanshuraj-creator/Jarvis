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
    private val onComplete: (List<String>) -> Unit
) {
    private val messages = initialMessages.toMutableList()
    private var index = 0
    private var cancelled = false
    private var completed = false

    private val runner = Runnable { runNext() }

    init {
        require(actions.size in 1..6) { "A task sequence must contain between one and six actions." }
    }

    fun start() {
        if (!cancelled && !completed) scheduler.post(runner, 0L)
    }

    fun cancel() {
        if (cancelled || completed) return
        cancelled = true
        scheduler.remove(runner)
    }

    private fun runNext() {
        if (cancelled || completed) return
        if (index >= actions.size) {
            finish()
            return
        }

        val action = actions[index]
        val result = executeAction(action)
        if (result.message.isNotBlank()) messages.add(result.message.take(380))
        index++

        if (!result.success || result.shouldStop || index >= actions.size) {
            finish()
            return
        }

        scheduler.post(runner, delayAfter(action).coerceIn(0L, 3000L))
    }

    private fun finish() {
        if (cancelled || completed) return
        completed = true
        onComplete(messages.toList())
    }
}
