package com.priyanshuraj.jarviscompanion.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CancellableActionSequenceTest {
    private class FakeScheduler : TaskScheduler {
        data class Entry(val task: Runnable, val delayMs: Long)
        val pending = mutableListOf<Entry>()

        override fun post(task: Runnable, delayMs: Long) {
            pending.add(Entry(task, delayMs))
        }

        override fun remove(task: Runnable) {
            pending.removeAll { it.task === task }
        }

        fun runNext() {
            val next = pending.removeAt(0)
            next.task.run()
        }
    }

    @Test
    fun completesActionsInOrderAndReportsMessagesOnce() {
        val scheduler = FakeScheduler()
        val executed = mutableListOf<Int>()
        val completions = mutableListOf<List<String>>()
        val sequence = CancellableActionSequence(
            actions = listOf(1, 2, 3),
            scheduler = scheduler,
            executeAction = { value ->
                executed.add(value)
                TaskStepResult(success = true, shouldStop = false, message = "step $value")
            },
            delayAfter = { 250L },
            initialMessages = listOf("Starting"),
            onComplete = { completions.add(it) }
        )

        sequence.start()
        scheduler.runNext()
        assertEquals(250L, scheduler.pending.single().delayMs)
        scheduler.runNext()
        scheduler.runNext()

        assertEquals(listOf(1, 2, 3), executed)
        assertEquals(1, completions.size)
        assertEquals(listOf("Starting", "step 1", "step 2", "step 3"), completions.single())
        assertTrue(scheduler.pending.isEmpty())
    }

    @Test
    fun cancelRemovesQueuedNextActionAndSuppressesCompletion() {
        val scheduler = FakeScheduler()
        val executed = mutableListOf<Int>()
        var completed = false
        val sequence = CancellableActionSequence(
            actions = listOf(1, 2, 3),
            scheduler = scheduler,
            executeAction = { value ->
                executed.add(value)
                TaskStepResult(success = true, shouldStop = false, message = "step $value")
            },
            delayAfter = { 1400L },
            onComplete = { completed = true }
        )

        sequence.start()
        scheduler.runNext()
        assertEquals(listOf(1), executed)
        assertEquals(1, scheduler.pending.size)

        sequence.cancel()
        assertTrue(scheduler.pending.isEmpty())
        assertFalse(completed)

        sequence.cancel()
        assertTrue(scheduler.pending.isEmpty())
        assertEquals(listOf(1), executed)
    }

    @Test
    fun cancellationBeforeFirstDispatchPreventsAnyAction() {
        val scheduler = FakeScheduler()
        var executed = 0
        var completed = false
        val sequence = CancellableActionSequence(
            actions = listOf("open", "search"),
            scheduler = scheduler,
            executeAction = {
                executed++
                TaskStepResult(true, false, it)
            },
            delayAfter = { 100L },
            onComplete = { completed = true }
        )

        sequence.start()
        sequence.cancel()
        assertTrue(scheduler.pending.isEmpty())
        assertEquals(0, executed)
        assertFalse(completed)
    }

    @Test
    fun failedOrUserCheckpointActionStopsTheRemainingSequence() {
        val scheduler = FakeScheduler()
        val executed = mutableListOf<String>()
        val completions = mutableListOf<List<String>>()
        val sequence = CancellableActionSequence(
            actions = listOf("open", "ask_user", "tap"),
            scheduler = scheduler,
            executeAction = { value ->
                executed.add(value)
                TaskStepResult(
                    success = true,
                    shouldStop = value == "ask_user",
                    message = value
                )
            },
            delayAfter = { 100L },
            onComplete = { completions.add(it) }
        )

        sequence.start()
        scheduler.runNext()
        scheduler.runNext()

        assertEquals(listOf("open", "ask_user"), executed)
        assertEquals(1, completions.size)
        assertEquals(listOf("open", "ask_user"), completions.single())
        assertTrue(scheduler.pending.isEmpty())
    }

    @Test
    fun failedActionStopsAndNeverSchedulesFollowingSteps() {
        val scheduler = FakeScheduler()
        val executed = mutableListOf<String>()
        val sequence = CancellableActionSequence(
            actions = listOf("open", "tap", "type"),
            scheduler = scheduler,
            executeAction = { value ->
                executed.add(value)
                TaskStepResult(
                    success = value != "tap",
                    shouldStop = false,
                    message = value
                )
            },
            delayAfter = { 100L },
            onComplete = {}
        )

        sequence.start()
        scheduler.runNext()
        scheduler.runNext()

        assertEquals(listOf("open", "tap"), executed)
        assertTrue(scheduler.pending.isEmpty())
    }

    @Test
    fun reportsEveryStepAndExactlyOneTerminalState() {
        val scheduler = FakeScheduler()
        val progress = mutableListOf<Pair<Int, Boolean>>()
        val terminal = mutableListOf<String>()
        val sequence = CancellableActionSequence(
            actions = listOf("open", "read"),
            scheduler = scheduler,
            executeAction = { TaskStepResult(true, false, it) },
            delayAfter = { 0L },
            onProgress = { index, result -> progress.add(index to result.success) },
            onTerminal = { terminal.add(it) },
            onComplete = {}
        )

        sequence.start()
        scheduler.runNext()
        scheduler.runNext()

        assertEquals(listOf(0 to true, 1 to true), progress)
        assertEquals(listOf("completed"), terminal)
    }

    @Test
    fun failedActionIsRecordedAndCancellationHasItsOwnTerminalState() {
        val scheduler = FakeScheduler()
        val progress = mutableListOf<Pair<Int, Boolean>>()
        val terminal = mutableListOf<String>()
        val failed = CancellableActionSequence(
            actions = listOf("open", "tap"),
            scheduler = scheduler,
            executeAction = { value -> TaskStepResult(value != "tap", false, value) },
            delayAfter = { 0L },
            onProgress = { index, result -> progress.add(index to result.success) },
            onTerminal = { terminal.add(it) },
            onComplete = {}
        )
        failed.start()
        scheduler.runNext()
        scheduler.runNext()
        assertEquals(listOf(0 to true, 1 to false), progress)
        assertEquals(listOf("failed"), terminal)

        val cancelScheduler = FakeScheduler()
        val cancelTerminal = mutableListOf<String>()
        val cancelled = CancellableActionSequence(
            actions = listOf("open", "read"),
            scheduler = cancelScheduler,
            executeAction = { TaskStepResult(true, false, it) },
            delayAfter = { 500L },
            onTerminal = { cancelTerminal.add(it) },
            onComplete = {}
        )
        cancelled.start()
        cancelled.cancel()
        assertEquals(listOf("cancelled"), cancelTerminal)
    }


    @Test
    fun pauseRemovesTheQueuedStepAndResumeContinuesFromTheSameIndex() {
        val scheduler = FakeScheduler()
        val executed = mutableListOf<String>()
        val states = mutableListOf<String>()
        val terminal = mutableListOf<String>()
        val sequence = CancellableActionSequence(
            actions = listOf("open", "read", "tap"),
            scheduler = scheduler,
            executeAction = { executed.add(it); TaskStepResult(true, false, it) },
            delayAfter = { 250L },
            onState = { state, index -> states.add("$state:$index") },
            onTerminal = { terminal.add(it) },
            onComplete = {}
        )

        sequence.start()
        scheduler.runNext()
        sequence.pause()
        assertTrue(scheduler.pending.isEmpty())
        assertEquals(listOf("open"), executed)
        sequence.resume()
        scheduler.runNext()
        scheduler.runNext()

        assertEquals(listOf("open", "read", "tap"), executed)
        assertEquals(listOf("running:0", "paused:1", "running:1"), states)
        assertEquals(listOf("completed"), terminal)
    }
}
