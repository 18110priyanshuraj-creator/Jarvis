package com.priyanshuraj.jarviscompanion

import androidx.room.Room
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.UUID

class NativeCommandDispatcherTest {
    @Test
    fun safeLocalCommandIsHandledBeforeAnyRemoteCall() {
        var remoteCalled = false
        val dispatcher = NativeCommandDispatcher(
            localCommand = { text, allowUi ->
                assertEquals("open calculator", text)
                assertFalse(allowUi)
                "Opening Calculator."
            },
            remoteAvailable = { true },
            remoteAssistant = { remoteCalled = true; "remote reply" }
        )
        val result = dispatcher.dispatch(
            NativeCommandRequest(" open calculator ", CoreCommandSource.HOME_TEXT)
        )
        assertEquals("Opening Calculator.", result.reply)
        assertEquals(CoreCommandRoute.LOCAL, result.route)
        assertEquals(CoreCommandOutcome.HANDLED, result.outcome)
        assertFalse(remoteCalled)
    }

    @Test
    fun unhandledCommandUsesRemoteOnlyWhenPairingIsAvailable() {
        var remoteCalls = 0
        val localOnly = NativeCommandDispatcher(
            localCommand = { _, _ -> null },
            remoteAvailable = { false },
            remoteAssistant = { error("Remote must not be called while unpaired.") }
        )
        val localOnlyResult = localOnly.dispatch(
            NativeCommandRequest("Explain gravity", CoreCommandSource.HOME_TEXT)
        )
        assertEquals(CoreCommandRoute.PAIRING_REQUIRED, localOnlyResult.route)

        val connected = NativeCommandDispatcher(
            localCommand = { _, _ -> null },
            remoteAvailable = { true },
            remoteAssistant = { text -> remoteCalls++; "Answer: $text" }
        )
        val remoteResult = connected.dispatch(
            NativeCommandRequest("Explain gravity", CoreCommandSource.SPEAK_ONCE)
        )
        assertEquals("Answer: Explain gravity", remoteResult.reply)
        assertEquals(CoreCommandRoute.REMOTE, remoteResult.route)
        assertEquals(1, remoteCalls)
    }

    @Test
    fun blankAndOversizedRequestsNeverReachLocalOrRemoteCode() {
        var localCalls = 0
        var remoteCalls = 0
        val dispatcher = NativeCommandDispatcher(
            localCommand = { _, _ -> localCalls++; null },
            remoteAvailable = { true },
            remoteAssistant = { remoteCalls++; "unexpected" }
        )
        val blank = dispatcher.dispatch(NativeCommandRequest(" ", CoreCommandSource.HOME_TEXT))
        val tooLong = dispatcher.dispatch(
            NativeCommandRequest(
                "x".repeat(NativeCommandDispatcher.MAX_MESSAGE_LENGTH + 1),
                CoreCommandSource.HOME_TEXT
            )
        )
        assertEquals(CoreCommandRoute.INVALID, blank.route)
        assertEquals(CoreCommandRoute.INVALID, tooLong.route)
        assertEquals(0, localCalls)
        assertEquals(0, remoteCalls)
    }

    @Test
    fun uiActionPermissionIsNotSilentlyElevated() {
        val flags = mutableListOf<Boolean>()
        val dispatcher = NativeCommandDispatcher(
            localCommand = { _, allow -> flags.add(allow); null },
            remoteAvailable = { false },
            remoteAssistant = { "unused" }
        )
        dispatcher.dispatch(NativeCommandRequest("go home", CoreCommandSource.HANDS_FREE, true))
        dispatcher.dispatch(NativeCommandRequest("go home", CoreCommandSource.HOME_TEXT, false))
        assertEquals(listOf(true, false), flags)
    }
}

class CoreExecutionRecordFactoryTest {
    @Test
    fun recordContainsOnlyBoundedExecutionMetadata() {
        val record = CoreExecutionRecordFactory.create(
            CoreCommandSource.SPEAK_ONCE,
            CoreCommandRoute.REMOTE,
            CoreCommandOutcome.SUCCESS,
            inputLength = 4_500,
            durationMs = Long.MAX_VALUE,
            recordedAtEpochMs = 10L,
            id = "test-id"
        )
        assertEquals("test-id", record.id)
        assertEquals("speak_once", record.source)
        assertEquals("remote", record.route)
        assertEquals("success", record.outcome)
        assertEquals(4_000, record.inputLength)
        assertEquals(CoreExecutionRecordFactory.MAX_RECORDED_DURATION_MS, record.durationMs)
        assertEquals(10L, record.recordedAtEpochMs)
        assertEquals(
            setOf("id", "source", "route", "outcome", "inputLength", "durationMs", "recordedAtEpochMs"),
            CoreExecutionRecordEntity::class.java.declaredFields.filterNot { it.isSynthetic }.map { it.name }.toSet()
        )
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class JarvisCoreDatabaseTest {
    private val app = RuntimeEnvironment.getApplication()
    private val databaseName = "jarvis-core-test-${UUID.randomUUID()}.db"
    private var database: JarvisCoreDatabase? = null

    @Before
    fun openDatabase() {
        database = Room.databaseBuilder(app, JarvisCoreDatabase::class.java, databaseName)
            .allowMainThreadQueries()
            .build()
    }

    @After
    fun closeDatabase() {
        database?.close()
        app.deleteDatabase(databaseName)
    }

    @Test
    fun executionRecordsSurviveReopenAndRetentionIsBounded() {
        val first = requireNotNull(database)
        val dao = first.executionDao()
        dao.insert(testRecord("old", 10L))
        dao.insert(testRecord("middle", 20L))
        dao.insert(testRecord("new", 30L))
        assertEquals(3, dao.count())
        dao.retainNewest(2)
        assertEquals(listOf("new", "middle"), dao.latest(10).map { it.id })

        first.close()
        database = Room.databaseBuilder(app, JarvisCoreDatabase::class.java, databaseName)
            .allowMainThreadQueries()
            .build()
        assertEquals(listOf("new", "middle"), database!!.executionDao().latest(10).map { it.id })
        assertEquals(2, database!!.executionDao().count())
    }

    private fun testRecord(id: String, at: Long) = CoreExecutionRecordFactory.create(
        CoreCommandSource.HANDS_FREE,
        CoreCommandRoute.REMOTE,
        CoreCommandOutcome.SUCCESS,
        inputLength = 16,
        durationMs = 250L,
        recordedAtEpochMs = at,
        id = id
    )
}
