package com.priyanshuraj.jarviscompanion

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import com.priyanshuraj.jarviscompanion.accessibility.JarvisAccessibilityService
import com.priyanshuraj.jarviscompanion.device.DeviceTokenStore
import com.priyanshuraj.jarviscompanion.voice.VoicePrivacyMode
import com.priyanshuraj.jarviscompanion.voice.VoicePrivacyPreferences
import com.priyanshuraj.jarviscompanion.voice.VoiceRecognitionPolicy
import android.speech.SpeechRecognizer

object PermissionSetup {
    data class Item(
        val title: String,
        val status: String,
        val detail: String,
        val required: Boolean
    )

    fun isMicrophoneGranted(context: Context): Boolean =
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    fun isNotificationsAllowed(context: Context): Boolean {
        val runtimeAllowed = Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val managerAllowed = context.getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() != false
        return runtimeAllowed && managerAllowed
    }

    fun isAccessibilityEnabled(context: Context): Boolean {
        val expected = ComponentName(context, JarvisAccessibilityService::class.java).flattenToString()
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ).orEmpty()
        return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    fun checklist(context: Context): List<Item> {
        val microphone = isMicrophoneGranted(context)
        val notifications = isNotificationsAllowed(context)
        val accessibility = isAccessibilityEnabled(context)
        val paired = !DeviceTokenStore.read(context).isNullOrBlank()
        val voiceMode = VoicePrivacyPreferences.read(context)
        val recognition = VoiceRecognitionPolicy.evaluate(
            mode = voiceMode,
            sdkInt = Build.VERSION.SDK_INT,
            recognitionServiceAvailable = SpeechRecognizer.isRecognitionAvailable(context),
            onDeviceRecognitionAvailable = Build.VERSION.SDK_INT >= 31 &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        )

        return listOf(
            Item(
                "Microphone",
                if (microphone) "Ready" else "Needs permission",
                if (microphone) "Voice input can listen after you start a session."
                else "Required for voice commands. Grant it using Android's permission dialog.",
                true
            ),
            Item(
                "Accessibility",
                if (accessibility) "Enabled" else "Needs manual setup",
                if (accessibility) "Screen controls can inspect accessible labels on-device."
                else "Required for screen reading, tapping and scrolling. Android requires you to enable this in Settings.",
                true
            ),
            Item(
                "Notifications",
                if (notifications) "Allowed" else "Optional / blocked",
                if (notifications) "The hands-free Stop notification can be shown."
                else "Recommended for the visible session notification. You can still use the app; open notification settings if you want it.",
                false
            ),
            Item(
                "Voice recognition privacy",
                voiceMode.displayName,
                recognition.status + " Language-pack availability is checked when a voice session starts. Offline-only voice replies also need an installed local text-to-speech voice. Conversational replies may still use the paired server.",
                false
            ),
            Item(
                "JARVIS server pairing",
                if (paired) "Paired" else "Not paired",
                if (paired) "Paired voice requests can use the configured server AI planner; supported app-search commands also have a built-in local fallback."
                else "Required for server-planned multi-step app search. Basic app launch and screen controls can work locally after the relevant Android permission is enabled.",
                false
            ),
            Item(
                "Storage and Downloads",
                "Not required",
                "JARVIS Companion does not read your Downloads folder or need broad storage access.",
                false
            ),
            Item(
                "Display over other apps",
                "Not required",
                "JARVIS uses Android's visible foreground-service notification, not a floating overlay.",
                false
            ),
            Item(
                "Install unknown apps",
                "Installer-controlled",
                "Only the app you use to open the APK (for example, your browser or file manager) may need this one-time install setting. JARVIS itself does not need permission to install apps.",
                false
            )
        )
    }

    fun render(context: Context): String = checklist(context).joinToString("\n\n") { item ->
        val badge = if (item.required) "[Required]" else "[Optional]"
        badge + " " + item.title + ": " + item.status + "\n" + item.detail
    }
}
