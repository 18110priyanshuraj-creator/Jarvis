package com.priyanshuraj.jarviscompanion.device

import android.content.Context
import com.priyanshuraj.jarviscompanion.PermissionSetup
import org.json.JSONObject
import java.util.concurrent.Executors

/** Sends bounded task state only. Commands, transcripts, screen text and screenshots stay local. */
object DeviceTaskReporter {
    private val executor = Executors.newSingleThreadExecutor()

    fun poll(context: Context): JSONObject? {
        val credentials = credentials(context) ?: return null
        return DeviceConnector.nextDashboardTask(credentials.first, credentials.second)
    }

    fun report(
        context: Context,
        status: String,
        step: Int,
        total: Int,
        category: String
    ) {
        val appContext = context.applicationContext
        executor.execute {
            val credentials = credentials(appContext) ?: return@execute
            runCatching {
                DeviceConnector.reportTaskStatus(
                    credentials.first,
                    credentials.second,
                    status,
                    step.coerceIn(0, 6),
                    total.coerceIn(1, 6),
                    category
                )
            }
        }
    }

    fun setBackgroundVoice(context: Context, active: Boolean) {
        val appContext = context.applicationContext
        executor.execute {
            val credentials = credentials(appContext) ?: return@execute
            runCatching {
                DeviceConnector.heartbeat(
                    credentials.first,
                    credentials.second,
                    PermissionSetup.isAccessibilityEnabled(appContext),
                    active
                )
            }
        }
    }

    private fun credentials(context: Context): Pair<String, String>? {
        val token = DeviceTokenStore.read(context)?.takeIf { it.isNotBlank() } ?: return null
        val serverUrl = context.getSharedPreferences("jarvis_companion_settings", Context.MODE_PRIVATE)
            .getString("server_url", null)
            ?.trim()
            ?.trimEnd('/')
            ?.takeIf { it.startsWith("https://", ignoreCase = true) }
            ?: return null
        return serverUrl to token
    }
}
