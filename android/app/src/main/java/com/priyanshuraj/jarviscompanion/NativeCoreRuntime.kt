package com.priyanshuraj.jarviscompanion

import android.app.Application
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import com.priyanshuraj.jarviscompanion.device.DeviceConnector
import com.priyanshuraj.jarviscompanion.device.DeviceTokenStore
import com.priyanshuraj.jarviscompanion.accessibility.JarvisAccessibilityService
import com.priyanshuraj.jarviscompanion.voice.LocalCommandProcessor
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

enum class CoreCommandSource(val storageKey: String) {
    HOME_TEXT("home_text"),
    SPEAK_ONCE("speak_once"),
    HANDS_FREE("hands_free")
}

enum class CoreCommandRoute(val storageKey: String) {
    LOCAL("local"),
    REMOTE("remote"),
    PAIRING_REQUIRED("pairing_required"),
    INVALID("invalid"),
    ERROR("error")
}

enum class CoreCommandOutcome(val storageKey: String) {
    SUCCESS("success"),
    HANDLED("handled"),
    UNHANDLED("unhandled"),
    PAIRING_REQUIRED("pairing_required"),
    FAILURE("failure"),
    INVALID("invalid")
}

data class NativeCommandRequest(
    val message: String,
    val source: CoreCommandSource,
    val allowUiActions: Boolean = false
)

data class NativeCommandResult(
    val reply: String,
    val route: CoreCommandRoute,
    val outcome: CoreCommandOutcome
)

/** One deterministic local-first route shared by typed and one-shot voice input. */
class NativeCommandDispatcher(
    private val localCommand: (String, Boolean) -> String?,
    private val remoteAvailable: () -> Boolean,
    private val remoteAssistant: (String) -> String
) {
    fun dispatch(request: NativeCommandRequest): NativeCommandResult {
        val message = request.message.trim()
        if (message.isBlank()) {
            return NativeCommandResult("Type or say a message first.", CoreCommandRoute.INVALID, CoreCommandOutcome.INVALID)
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            return NativeCommandResult(
                "That request is too long. Keep a single JARVIS request under $MAX_MESSAGE_LENGTH characters.",
                CoreCommandRoute.INVALID,
                CoreCommandOutcome.INVALID
            )
        }
        val localReply = localCommand(message, request.allowUiActions)
        if (!localReply.isNullOrBlank()) {
            return NativeCommandResult(localReply, CoreCommandRoute.LOCAL, CoreCommandOutcome.HANDLED)
        }
        if (!remoteAvailable()) {
            return NativeCommandResult(
                "Pair this device with your JARVIS dashboard to use remote assistant replies. Local commands remain available.",
                CoreCommandRoute.PAIRING_REQUIRED,
                CoreCommandOutcome.PAIRING_REQUIRED
            )
        }
        val answer = remoteAssistant(message).trim()
        if (answer.isBlank()) throw IllegalStateException("JARVIS returned an empty answer.")
        return NativeCommandResult(answer, CoreCommandRoute.REMOTE, CoreCommandOutcome.SUCCESS)
    }

    companion object {
        const val MAX_MESSAGE_LENGTH = 4_000
    }
}

/** Privacy-minimized metadata only; no transcript, prompt, screen text, URL or credential columns. */
@Entity(
    tableName = "core_execution_records",
    indices = [
        Index(value = ["recordedAtEpochMs"]),
        Index(value = ["source", "recordedAtEpochMs"])
    ]
)
data class CoreExecutionRecordEntity(
    @PrimaryKey val id: String,
    val source: String,
    val route: String,
    val outcome: String,
    val inputLength: Int,
    val durationMs: Long,
    val recordedAtEpochMs: Long
)

object CoreExecutionRecordFactory {
    fun create(
        source: CoreCommandSource,
        route: CoreCommandRoute,
        outcome: CoreCommandOutcome,
        inputLength: Int,
        durationMs: Long,
        recordedAtEpochMs: Long = System.currentTimeMillis(),
        id: String = UUID.randomUUID().toString()
    ) = CoreExecutionRecordEntity(
        id = id,
        source = source.storageKey,
        route = route.storageKey,
        outcome = outcome.storageKey,
        inputLength = inputLength.coerceIn(0, NativeCommandDispatcher.MAX_MESSAGE_LENGTH),
        durationMs = durationMs.coerceIn(0L, MAX_RECORDED_DURATION_MS),
        recordedAtEpochMs = recordedAtEpochMs.coerceAtLeast(0L)
    )

    const val MAX_RECORDED_DURATION_MS = 10 * 60 * 1000L
}

@Dao
interface CoreExecutionDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    fun insert(record: CoreExecutionRecordEntity)

    @Query("SELECT * FROM core_execution_records ORDER BY recordedAtEpochMs DESC, id DESC LIMIT :limit")
    fun latest(limit: Int): List<CoreExecutionRecordEntity>

    @Query(
        "DELETE FROM core_execution_records WHERE id NOT IN (" +
            "SELECT id FROM core_execution_records ORDER BY recordedAtEpochMs DESC, id DESC LIMIT :keepCount)"
    )
    fun retainNewest(keepCount: Int): Int

    @Query("SELECT COUNT(*) FROM core_execution_records")
    fun count(): Int
}

@Database(entities = [CoreExecutionRecordEntity::class], version = 1, exportSchema = false)
abstract class JarvisCoreDatabase : RoomDatabase() {
    abstract fun executionDao(): CoreExecutionDao
}

class CoreExecutionLedger(
    private val dao: CoreExecutionDao,
    private val ioExecutor: Executor
) {
    fun record(
        source: CoreCommandSource,
        route: CoreCommandRoute,
        outcome: CoreCommandOutcome,
        inputLength: Int,
        durationMs: Long
    ) {
        val record = CoreExecutionRecordFactory.create(source, route, outcome, inputLength, durationMs)
        runCatching {
            ioExecutor.execute {
                runCatching {
                    dao.insert(record)
                    dao.retainNewest(MAX_RECORDS)
                }
            }
        }
    }

    fun latest(limit: Int, callback: (List<CoreExecutionRecordEntity>) -> Unit) {
        ioExecutor.execute {
            val records = runCatching {
                dao.latest(limit.coerceIn(1, MAX_RECORDS))
            }.getOrDefault(emptyList())
            callback(records)
        }
    }

    companion object {
        const val MAX_RECORDS = 500
    }
}

/** Process-wide core. Existing remote data and Keystore credentials are not migrated. */
class NativeCoreRuntime(context: Context) {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences("jarvis_companion_settings", Context.MODE_PRIVATE)
    private val callbackHandler = Handler(Looper.getMainLooper())
    private val commandExecutor: ExecutorService = Executors.newFixedThreadPool(2)
    private val ledgerExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val database = Room.databaseBuilder(appContext, JarvisCoreDatabase::class.java, DATABASE_NAME).build()
    private val ledger = CoreExecutionLedger(database.executionDao(), ledgerExecutor)
    private val localMemoryRuntime = LocalMemoryRuntime(appContext)
    private val localMemoryCommands = LocalMemoryCommandHandler(localMemoryRuntime.repository)
    private val systemController = LocalSystemController(AndroidLocalSystemPlatform(appContext))

    private data class RemoteCredentials(val serverUrl: String, val token: String)

    private fun currentApplicationId(): String =
        JarvisAccessibilityService.currentForegroundApplicationId() ?: "android-companion"

    private fun remoteCredentials(): RemoteCredentials? {
        val token = DeviceTokenStore.read(appContext)?.takeIf { it.isNotBlank() } ?: return null
        val serverUrl = preferences.getString("server_url", null)
            ?.trim()
            ?.trimEnd('/')
            ?.takeIf { it.startsWith("https://", ignoreCase = true) }
            ?: return null
        return RemoteCredentials(serverUrl, token)
    }

    fun isRemoteConnected(): Boolean = remoteCredentials() != null

    fun submitCommand(
        message: String,
        source: CoreCommandSource,
        allowUiActions: Boolean = false,
        onComplete: (NativeCommandResult) -> Unit
    ) {
        commandExecutor.execute {
            val startedAt = System.currentTimeMillis()
            val dispatcher = NativeCommandDispatcher(
                localCommand = { text, allowActions ->
                    localMemoryCommands.handle(text)
                        ?: systemController.handle(text)
                        ?: LocalCommandProcessor.handle(appContext, text, allowActions)
                },
                remoteAvailable = { remoteCredentials() != null },
                remoteAssistant = { text ->
                    val credentials = remoteCredentials()
                        ?: throw IllegalStateException("Pair this device before requesting a remote assistant reply.")
                    DeviceConnector.voiceCommand(credentials.serverUrl, credentials.token, text, currentApplicationId())
                }
            )
            val result = try {
                dispatcher.dispatch(NativeCommandRequest(message, source, allowUiActions))
            } catch (error: Exception) {
                NativeCommandResult(
                    error.message ?: "The JARVIS request could not be completed.",
                    CoreCommandRoute.ERROR,
                    CoreCommandOutcome.FAILURE
                )
            }
            ledger.record(
                source, result.route, result.outcome, message.trim().length,
                System.currentTimeMillis() - startedAt
            )
            callbackHandler.post { onComplete(result) }
        }
    }

    fun handleLocalCommand(message: String, source: CoreCommandSource, allowUiActions: Boolean): String? {
        val startedAt = System.currentTimeMillis()
        return try {
            val result = localMemoryCommands.handle(message)
                ?: systemController.handle(message)
                ?: LocalCommandProcessor.handle(appContext, message, allowUiActions)
            ledger.record(
                source,
                if (result == null) CoreCommandRoute.INVALID else CoreCommandRoute.LOCAL,
                if (result == null) CoreCommandOutcome.UNHANDLED else CoreCommandOutcome.HANDLED,
                message.trim().length,
                System.currentTimeMillis() - startedAt
            )
            result
        } catch (error: Exception) {
            ledger.record(
                source, CoreCommandRoute.ERROR, CoreCommandOutcome.FAILURE,
                message.trim().length, System.currentTimeMillis() - startedAt
            )
            error.message ?: "The local Android command could not be completed."
        }
    }

    fun pairDevice(serverUrl: String, pairingCode: String) =
        DeviceConnector.pair(serverUrl, pairingCode)

    fun heartbeat(serverUrl: String, token: String, accessibilityEnabled: Boolean) {
        DeviceConnector.heartbeat(serverUrl, token, accessibilityEnabled)
    }

    fun requestAgentPlan(
        message: String,
        source: CoreCommandSource = CoreCommandSource.HANDS_FREE
    ): JSONObject {
        val credentials = remoteCredentials()
            ?: throw IllegalStateException("Pair this device with JARVIS before requesting an action plan.")
        val startedAt = System.currentTimeMillis()
        return try {
            val plan = DeviceConnector.agentPlan(credentials.serverUrl, credentials.token, message)
            ledger.record(
                source, CoreCommandRoute.REMOTE, CoreCommandOutcome.SUCCESS,
                message.trim().length, System.currentTimeMillis() - startedAt
            )
            plan
        } catch (error: Exception) {
            ledger.record(
                source, CoreCommandRoute.ERROR, CoreCommandOutcome.FAILURE,
                message.trim().length, System.currentTimeMillis() - startedAt
            )
            throw error
        }
    }

    fun requestAssistantReply(message: String, source: CoreCommandSource): String {
        val localMemoryReply = localMemoryCommands.handle(message)
        if (localMemoryReply != null) {
            ledger.record(source, CoreCommandRoute.LOCAL, CoreCommandOutcome.HANDLED, message.trim().length, 0L)
            return localMemoryReply
        }
        val credentials = remoteCredentials()
            ?: throw IllegalStateException("Pair this device with JARVIS before requesting a remote reply.")
        val startedAt = System.currentTimeMillis()
        return try {
            val answer = DeviceConnector.voiceCommand(credentials.serverUrl, credentials.token, message, currentApplicationId())
            ledger.record(
                source, CoreCommandRoute.REMOTE, CoreCommandOutcome.SUCCESS,
                message.trim().length, System.currentTimeMillis() - startedAt
            )
            answer
        } catch (error: Exception) {
            ledger.record(
                source, CoreCommandRoute.ERROR, CoreCommandOutcome.FAILURE,
                message.trim().length, System.currentTimeMillis() - startedAt
            )
            throw error
        }
    }

    fun loadRecentHistory(limit: Int, onComplete: (List<String>) -> Unit) {
        ledger.latest(limit) { records ->
            val formatter = SimpleDateFormat("dd MMM, HH:mm", Locale.getDefault())
            val summaries = records.map { record ->
                val at = formatter.format(Date(record.recordedAtEpochMs))
                "$at · ${record.source} · ${record.route} · ${record.outcome} · ${record.inputLength} chars"
            }
            callbackHandler.post { onComplete(summaries) }
        }
    }

    fun loadLocalMemories(query: String = "", onComplete: (Result<List<LocalMemoryNote>>) -> Unit) {
        runMemoryOperation({ localMemoryRuntime.repository.list(query) }, onComplete)
    }

    fun saveLocalMemory(content: String, category: String, onComplete: (Result<LocalMemoryNote>) -> Unit) {
        runMemoryOperation({ localMemoryRuntime.repository.save(content, category) }, onComplete)
    }

    fun updateLocalMemory(id: String, content: String, category: String, onComplete: (Result<LocalMemoryNote>) -> Unit) {
        runMemoryOperation({ localMemoryRuntime.repository.update(id, content, category) }, onComplete)
    }

    fun setLocalMemoryEnabled(id: String, enabled: Boolean, onComplete: (Result<LocalMemoryNote>) -> Unit) {
        runMemoryOperation({ localMemoryRuntime.repository.setEnabled(id, enabled) }, onComplete)
    }

    fun deleteLocalMemory(id: String, onComplete: (Result<Boolean>) -> Unit) {
        runMemoryOperation({ localMemoryRuntime.repository.delete(id) }, onComplete)
    }

    private fun <T> runMemoryOperation(operation: () -> T, onComplete: (Result<T>) -> Unit) {
        commandExecutor.execute {
            val result = runCatching { operation() }
            callbackHandler.post { onComplete(result) }
        }
    }

    fun close() {
        commandExecutor.shutdownNow()
        ledgerExecutor.shutdown()
        localMemoryRuntime.close()
        database.close()
    }

    companion object {
        private const val DATABASE_NAME = "jarvis_core.db"
    }
}

/** Application scope lets Activity and microphone Service share one native runtime. */
class JarvisApplication : Application() {
    private val coreDelegate = lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        NativeCoreRuntime(applicationContext)
    }

    val core: NativeCoreRuntime
        get() = coreDelegate.value

    override fun onCreate() {
        super.onCreate()
        LocalTaskExecutionJournal.recoverInterrupted(applicationContext)
    }

    override fun onTerminate() {
        if (coreDelegate.isInitialized()) coreDelegate.value.close()
        super.onTerminate()
    }
}
