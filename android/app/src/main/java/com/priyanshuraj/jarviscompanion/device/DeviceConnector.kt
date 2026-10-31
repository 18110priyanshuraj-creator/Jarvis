package com.priyanshuraj.jarviscompanion.device

import android.os.Build
import org.json.JSONObject
import java.io.IOException
import java.net.URL
import javax.net.ssl.HttpsURLConnection

data class PairingResult(
    val deviceId: String,
    val deviceToken: String,
    val displayName: String
)

object DeviceConnector {
    fun pair(serverUrl: String, code: String): PairingResult {
        val body = JSONObject()
            .put("code", code.trim())
            .put("name", "Android Companion - " + Build.MODEL)
            .put("manufacturer", Build.MANUFACTURER)
            .put("model", Build.MODEL)
            .put("androidVersion", Build.VERSION.RELEASE ?: "unknown")
            .put("appVersion", "0.1.0-phase1")

        val response = request(serverUrl, "/api/devices/pair", body, null)
        val device = response.optJSONObject("device") ?: throw IOException("The server returned no paired-device record.")
        val token = response.optString("deviceToken")
        if (token.length < 40) throw IOException("The server returned an invalid device credential.")
        return PairingResult(
            deviceId = device.optString("id"),
            deviceToken = token,
            displayName = device.optString("name", "Android Companion")
        )
    }

    fun heartbeat(serverUrl: String, token: String, accessibilityEnabled: Boolean) {
        request(
            serverUrl,
            "/api/devices/heartbeat",
            JSONObject()
                .put("accessibilityEnabled", accessibilityEnabled)
                .put("appVersion", "0.1.0-phase1"),
            token
        )
    }

    fun voiceCommand(serverUrl: String, token: String, message: String): String {
        val response = request(
            serverUrl,
            "/api/devices/voice-command",
            JSONObject().put("message", message),
            token
        )
        return response.optString("answer").takeIf { it.isNotBlank() }
            ?: throw IOException("JARVIS returned an empty answer.")
    }

    private fun request(
        serverUrl: String,
        path: String,
        payload: JSONObject,
        bearerToken: String?
    ): JSONObject {
        val normalizedBase = serverUrl.trim().trimEnd('/')
        require(normalizedBase.startsWith("https://", ignoreCase = true)) {
            "Use your JARVIS HTTPS address. Insecure HTTP connections are blocked."
        }

        val url = URL(normalizedBase + path)
        require(url.protocol.equals("https", ignoreCase = true)) {
            "Only HTTPS connections are accepted."
        }

        val connection = url.openConnection() as HttpsURLConnection
        connection.requestMethod = "POST"
        connection.connectTimeout = 12_000
        connection.readTimeout = 20_000
        connection.doOutput = true
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        if (!bearerToken.isNullOrBlank()) {
            connection.setRequestProperty("Authorization", "Bearer " + bearerToken)
        }

        try {
            connection.outputStream.use { output ->
                output.write(payload.toString().toByteArray(Charsets.UTF_8))
            }
            val statusCode = connection.responseCode
            val stream = if (statusCode in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val response = try {
                JSONObject(responseText.ifBlank { "{}" })
            } catch (_: Exception) {
                throw IOException("The JARVIS server returned an unreadable response.")
            }
            if (statusCode !in 200..299) {
                throw IOException(response.optString("error", "").ifBlank { "JARVIS request failed (HTTP " + statusCode + ")." })
            }
            return response
        } finally {
            connection.disconnect()
        }
    }
}
