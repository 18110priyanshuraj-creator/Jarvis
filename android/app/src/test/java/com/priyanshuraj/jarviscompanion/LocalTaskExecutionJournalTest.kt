package com.priyanshuraj.jarviscompanion

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LocalTaskExecutionJournalTest {
    private val app = RuntimeEnvironment.getApplication()

    @Before
    fun clearBefore() {
        LocalTaskExecutionJournal.clear(app)
    }

    @After
    fun clearAfter() {
        LocalTaskExecutionJournal.clear(app)
    }

    @Test
    fun stepCheckpointsPersistAndRunningTasksRecoverWithoutAutomaticReplay() {
        val id = LocalTaskExecutionJournal.start(
            app,
            listOf("open app", "read screen", "tap label")
        )

        val afterFirstStep = LocalTaskExecutionJournal.checkpoint(
            app, id, stepIndex = 0, success = true, shouldStop = false
        )
        assertEquals("running", afterFirstStep?.status)
        assertEquals(1, afterFirstStep?.currentStepIndex)
        assertEquals(listOf("completed", "pending", "pending"), afterFirstStep?.stepStatuses)

        LocalTaskExecutionJournal.setState(app, id, "paused", currentStepIndex = 1)
        val recovered = LocalTaskExecutionJournal.recoverInterrupted(app)
        assertEquals(1, recovered.size)
        assertEquals(id, recovered.single().id)
        assertEquals("interrupted", recovered.single().status)
        assertTrue(recovered.single().requiresManualReplan)
        assertEquals(1, recovered.single().currentStepIndex)
        assertEquals(listOf("completed", "pending", "pending"), recovered.single().stepStatuses)
        assertEquals("interrupted", LocalTaskExecutionJournal.history(app).single().status)
    }

    @Test
    fun waitingForUserTasksAreMarkedInterruptedAfterRestart() {
        val id = LocalTaskExecutionJournal.start(app, listOf("ask user", "read screen"))
        LocalTaskExecutionJournal.checkpoint(app, id, 0, success = true, shouldStop = true)
        assertEquals("waiting_user", LocalTaskExecutionJournal.history(app).single().status)
        val recovered = LocalTaskExecutionJournal.recoverInterrupted(app).single()
        assertEquals("interrupted", recovered.status)
        assertTrue(recovered.requiresManualReplan)
    }

    @Test
    fun completedTasksAreNotRecoveredAndHistoryIsBounded() {
        val completedId = LocalTaskExecutionJournal.start(app, listOf("read screen"))
        LocalTaskExecutionJournal.checkpoint(app, completedId, 0, success = true, shouldStop = false)
        LocalTaskExecutionJournal.finish(app, completedId, "completed")
        assertTrue(LocalTaskExecutionJournal.recoverInterrupted(app).isEmpty())
        assertEquals("completed", LocalTaskExecutionJournal.history(app).single().status)

        repeat(22) {
            val id = LocalTaskExecutionJournal.start(app, listOf("read screen"))
            LocalTaskExecutionJournal.finish(app, id, "cancelled")
        }
        assertEquals(20, LocalTaskExecutionJournal.history(app).size)
    }

    @Test
    fun persistedJournalContainsOnlyGenericActionCategories() {
        LocalTaskExecutionJournal.start(
            app,
            listOf("open app", "verify app", "type text", "verify screen")
        )
        val raw = app.getSharedPreferences("jarvis_companion_task_journal", 0)
            .getString("records", "[]") ?: "[]"
        assertTrue(raw.contains("open app"))
        assertTrue(raw.contains("verify app"))
        assertTrue(raw.contains("type text"))
        assertTrue(raw.contains("verify screen"))
        assertFalse(raw.contains("account password"))
        assertFalse(raw.contains("sensitive text from an input field"))
        assertFalse(raw.contains("https://"))
    }
}
