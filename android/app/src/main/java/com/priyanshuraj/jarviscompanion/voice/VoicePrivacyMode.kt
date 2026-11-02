package com.priyanshuraj.jarviscompanion.voice

import android.content.Context

enum class VoicePrivacyMode(val storageKey: String, val displayName: String) {
    PREFER_OFFLINE("prefer_offline", "Prefer offline"),
    OFFLINE_ONLY("offline_only", "Offline only");

    companion object {
        fun fromStorage(value: String?): VoicePrivacyMode =
            values().firstOrNull { it.storageKey == value } ?: PREFER_OFFLINE
    }
}

data class VoiceRecognitionDecision(
    val canStart: Boolean,
    val useOnDeviceRecognizer: Boolean,
    val preferOfflineHint: Boolean,
    val status: String
)

/** Pure policy: strict offline mode never silently switches to a network recognizer. */
object VoiceRecognitionPolicy {
    fun evaluate(
        mode: VoicePrivacyMode,
        sdkInt: Int,
        recognitionServiceAvailable: Boolean,
        onDeviceRecognitionAvailable: Boolean
    ): VoiceRecognitionDecision {
        if (!recognitionServiceAvailable) {
            return VoiceRecognitionDecision(
                canStart = false,
                useOnDeviceRecognizer = false,
                preferOfflineHint = false,
                status = "Android speech recognition is unavailable. Enable a speech service in Android Settings."
            )
        }

        val hasOnDeviceRecognizer = sdkInt >= 31 && onDeviceRecognitionAvailable
        if (hasOnDeviceRecognizer) {
            return VoiceRecognitionDecision(
                canStart = true,
                useOnDeviceRecognizer = true,
                preferOfflineHint = false,
                status = "On-device speech recognition selected. Language availability is checked when you speak."
            )
        }

        return when (mode) {
            VoicePrivacyMode.OFFLINE_ONLY -> VoiceRecognitionDecision(
                canStart = false,
                useOnDeviceRecognizer = false,
                preferOfflineHint = false,
                status = "Offline speech recognition is unavailable on this device. No online recognizer was started. Use Android 12 or later with an installed on-device speech service, or change Voice privacy to Prefer offline."
            )
            VoicePrivacyMode.PREFER_OFFLINE -> VoiceRecognitionDecision(
                canStart = true,
                useOnDeviceRecognizer = false,
                preferOfflineHint = true,
                status = "On-device speech recognition is unavailable. Using the Android system speech service; it may require internet. This is not guaranteed offline."
            )
        }
    }
}

object VoicePrivacyPreferences {
    private const val PREFS_NAME = "jarvis_companion_settings"
    private const val KEY_MODE = "voice_privacy_mode"

    fun read(context: Context): VoicePrivacyMode {
        val value = context.applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_MODE, VoicePrivacyMode.PREFER_OFFLINE.storageKey)
        return VoicePrivacyMode.fromStorage(value)
    }

    fun write(context: Context, mode: VoicePrivacyMode) {
        context.applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_MODE, mode.storageKey)
            .apply()
    }
}
