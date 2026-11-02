package com.priyanshuraj.jarviscompanion

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.provider.Settings
import java.util.Locale

enum class SystemSettingsTarget(val label: String) {
    GENERAL("general"), WIFI("Wi-Fi"), WIRELESS("wireless/network"), BLUETOOTH("Bluetooth"),
    DISPLAY("display"), SOUND("sound"), BATTERY("battery saver"), LOCATION("location"),
    AIRPLANE_MODE("airplane mode"), ACCESSIBILITY("accessibility"),
    APP_PERMISSIONS("JARVIS app permissions"), APP_NOTIFICATIONS("JARVIS app notifications"),
    HOTSPOT("hotspot")
}

sealed class LocalSystemCommand {
    object DeviceStatus : LocalSystemCommand()
    object Help : LocalSystemCommand()
    object VolumeUp : LocalSystemCommand()
    object VolumeDown : LocalSystemCommand()
    object Mute : LocalSystemCommand()
    object Unmute : LocalSystemCommand()
    data class SetVolume(val percent: Int) : LocalSystemCommand()
    data class InvalidVolume(val requested: Int) : LocalSystemCommand()
    data class OpenSettings(val target: SystemSettingsTarget, val manualChangeRequired: Boolean = false) : LocalSystemCommand()
}

data class DeviceSystemSnapshot(
    val batteryPercent: Int?,
    val charging: Boolean?,
    val networkLabel: String,
    val mediaVolumePercent: Int
)

interface LocalSystemPlatform {
    fun readSnapshot(): DeviceSystemSnapshot
    fun increaseMediaVolume()
    fun decreaseMediaVolume()
    fun muteMediaVolume()
    fun unmuteMediaVolume()
    fun setMediaVolume(percent: Int)
    fun openSettings(target: SystemSettingsTarget): Boolean
}

object SystemControlCommandParser {
    private val volumePattern = Regex("""^(?:set\s+)?(?:media\s+)?(?:volume|sound)(?:\s+to)?\s+(\d{1,3})(?:\s*(?:percent|%))?$""")
    private val settingsAliases = mapOf(
        SystemSettingsTarget.GENERAL to setOf("settings", "system settings", "general settings"),
        SystemSettingsTarget.WIFI to setOf("wifi", "wi fi", "internet", "वाईफाई", "वाई फाई", "वाइफाई"),
        SystemSettingsTarget.WIRELESS to setOf("wireless", "network", "mobile data", "data network", "नेटवर्क", "मोबाइल डेटा"),
        SystemSettingsTarget.BLUETOOTH to setOf("bluetooth", "ब्लूटूथ"),
        SystemSettingsTarget.DISPLAY to setOf("display", "screen", "brightness", "डिस्प्ले", "ब्राइटनेस"),
        SystemSettingsTarget.SOUND to setOf("sound", "audio", "volume settings", "ध्वनि", "आवाज"),
        SystemSettingsTarget.BATTERY to setOf("battery", "battery saver", "power saving", "बैटरी"),
        SystemSettingsTarget.LOCATION to setOf("location", "gps", "लोकेशन", "स्थान"),
        SystemSettingsTarget.AIRPLANE_MODE to setOf("airplane mode", "flight mode", "flight", "एयरप्लेन मोड"),
        SystemSettingsTarget.ACCESSIBILITY to setOf("accessibility", "screen access", "असिस्टिव एक्सेस"),
        SystemSettingsTarget.APP_PERMISSIONS to setOf("app permissions", "jarvis permissions", "app info", "application info"),
        SystemSettingsTarget.APP_NOTIFICATIONS to setOf("app notifications", "notification settings", "notifications"),
        SystemSettingsTarget.HOTSPOT to setOf("hotspot", "mobile hotspot", "tethering", "हॉटस्पॉट")
    )

    fun parse(input: String): LocalSystemCommand? {
        val value = normalize(input)
        if (value.isBlank()) return null
        if (value in setOf(
                "status", "device status", "system status", "tablet status", "phone status",
                "battery", "battery status", "battery kitni hai", "battery kitna hai",
                "battery kitni bachi hai", "network status", "internet status", "wifi status",
                "wi fi status", "volume status", "volume kitna hai", "device ki condition",
                "डिवाइस स्टेटस", "सिस्टम स्टेटस", "बैटरी कितनी है", "बैटरी कितनी बची है",
                "वॉल्यूम कितना है", "इंटरनेट स्टेटस"
            )
        ) return LocalSystemCommand.DeviceStatus

        if (value in setOf(
                "what can you control", "what can you do locally", "local controls",
                "system controls", "tum kya control kar sakte ho", "aap kya control kar sakte ho",
                "तुम क्या कंट्रोल कर सकते हो", "आप क्या कंट्रोल कर सकते हैं"
            )
        ) return LocalSystemCommand.Help

        val volumeMatch = volumePattern.matchEntire(value)
        if (volumeMatch != null) {
            val requested = volumeMatch.groupValues[1].toInt()
            return if (requested in 0..100) LocalSystemCommand.SetVolume(requested)
            else LocalSystemCommand.InvalidVolume(requested)
        }
        if (value in setOf(
                "volume up", "increase volume", "raise volume", "turn volume up",
                "volume increase", "volume badhao", "volume badha do", "awaz badhao",
                "awaaz badhao", "awaz tez karo", "आवाज़ बढ़ाओ", "आवाज बढ़ाओ", "वॉल्यूम बढ़ाओ"
            )
        ) return LocalSystemCommand.VolumeUp
        if (value in setOf(
                "volume down", "decrease volume", "lower volume", "turn volume down",
                "volume decrease", "volume kam karo", "volume ghatao", "awaz kam karo",
                "awaaz kam karo", "आवाज़ कम करो", "आवाज कम करो", "वॉल्यूम कम करो"
            )
        ) return LocalSystemCommand.VolumeDown
        if (value in setOf("mute", "mute volume", "volume mute", "awaz band", "आवाज़ बंद करो", "आवाज बंद करो")) {
            return LocalSystemCommand.Mute
        }
        if (value in setOf("unmute", "unmute volume", "volume unmute", "awaz chalu", "आवाज़ चालू करो", "आवाज चालू करो")) {
            return LocalSystemCommand.Unmute
        }
        return parseSettings(value)
    }

    private fun parseSettings(value: String): LocalSystemCommand.OpenSettings? {
        val openMatch = Regex("""^(?:please\s+)?(?:open|show|go to|launch)\s+(.+)$""").matchEntire(value)
        if (openMatch != null) {
            val target = resolveTarget(openMatch.groupValues[1]) ?: return null
            return LocalSystemCommand.OpenSettings(target)
        }
        if (value in setOf("settings kholo", "settings khol do", "settings open karo")) {
            return LocalSystemCommand.OpenSettings(SystemSettingsTarget.GENERAL)
        }
        for (suffix in listOf(" settings kholo", " settings khol do", " settings open karo")) {
            if (value.endsWith(suffix)) {
                val target = resolveTarget(value.removeSuffix(suffix)) ?: return null
                return LocalSystemCommand.OpenSettings(target)
            }
        }

        val toggleValue = Regex("""^(?:turn|switch)\s+(?:on|off)\s+(.+)$""").matchEntire(value)?.groupValues?.get(1)
            ?: Regex("""^(?:turn|switch)\s+(.+?)\s+(?:on|off)$""").matchEntire(value)?.groupValues?.get(1)
            ?: Regex("""^(?:enable|disable)\s+(.+)$""").matchEntire(value)?.groupValues?.get(1)
            ?: Regex("""^(.+?)\s+(?:on|off)$""").matchEntire(value)?.groupValues?.get(1)
            ?: Regex("""^(.+?)\s+(?:chalu|band)(?:\s+(?:karo|kar do))?$""").matchEntire(value)?.groupValues?.get(1)
            ?: Regex("""^(.+?)\s+(?:चालू|बंद)(?:\s+करो)?$""").matchEntire(value)?.groupValues?.get(1)
        if (toggleValue != null) {
            val target = resolveTarget(toggleValue) ?: return null
            if (target in setOf(
                    SystemSettingsTarget.WIFI, SystemSettingsTarget.WIRELESS, SystemSettingsTarget.BLUETOOTH,
                    SystemSettingsTarget.LOCATION, SystemSettingsTarget.AIRPLANE_MODE, SystemSettingsTarget.HOTSPOT
                )
            ) return LocalSystemCommand.OpenSettings(target, manualChangeRequired = true)
        }
        return null
    }

    private fun resolveTarget(input: String): SystemSettingsTarget? {
        var phrase = normalize(input)
        if (phrase.startsWith("settings for ")) phrase = phrase.removePrefix("settings for ").trim()
        if (phrase.endsWith(" settings")) phrase = phrase.removeSuffix(" settings").trim()
        if (phrase == "settings" || phrase == "system") return SystemSettingsTarget.GENERAL
        return settingsAliases.entries.firstOrNull { (_, aliases) -> phrase in aliases }?.key
    }

    private fun normalize(value: String): String = value.lowercase(Locale.ROOT)
        .replace(Regex("""[^\p{L}\p{M}\p{N}%]+"""), " ")
        .replace(Regex("""\s+"""), " ")
        .trim()
}

class LocalSystemController(private val platform: LocalSystemPlatform) {
    fun handle(message: String): String? {
        val command = SystemControlCommandParser.parse(message) ?: return null
        return try {
            when (command) {
                LocalSystemCommand.DeviceStatus -> formatStatus(platform.readSnapshot())
                LocalSystemCommand.Help -> HELP_MESSAGE
                LocalSystemCommand.VolumeUp -> { platform.increaseMediaVolume(); "Media volume increased." }
                LocalSystemCommand.VolumeDown -> { platform.decreaseMediaVolume(); "Media volume decreased." }
                LocalSystemCommand.Mute -> { platform.muteMediaVolume(); "Media volume muted." }
                LocalSystemCommand.Unmute -> { platform.unmuteMediaVolume(); "Media volume unmuted." }
                is LocalSystemCommand.SetVolume -> {
                    platform.setMediaVolume(command.percent)
                    "Media volume set to " + command.percent + "%."
                }
                is LocalSystemCommand.InvalidVolume ->
                    "Choose a media volume from 0 to 100 percent. No volume change was made."
                is LocalSystemCommand.OpenSettings -> {
                    if (!platform.openSettings(command.target)) {
                        "Android could not open the " + command.target.label + " settings page. Open Settings manually."
                    } else if (command.manualChangeRequired) {
                        "Android requires you to change " + command.target.label + " yourself. The settings page is open; choose the requested option there."
                    } else {
                        "Opened Android " + command.target.label + " settings."
                    }
                }
            }
        } catch (_: SecurityException) {
            "Android blocked that system control. Check the relevant permission in Settings."
        } catch (_: Exception) {
            "That system control could not be completed. Check Android Settings and try again."
        }
    }

    private fun formatStatus(snapshot: DeviceSystemSnapshot): String {
        val battery = snapshot.batteryPercent?.let { it.toString() + "%" } ?: "unavailable"
        val charging = when (snapshot.charging) {
            true -> "charging"
            false -> "not charging"
            null -> "charge state unavailable"
        }
        return "Device status: battery " + battery + " (" + charging + "); network " +
            snapshot.networkLabel + "; media volume " + snapshot.mediaVolumePercent.coerceIn(0, 100) + "%."
    }

    companion object {
        private const val HELP_MESSAGE =
            "Local controls: check device and network status; raise, lower, mute, unmute or set media volume; launch installed apps; and open Android settings for Wi-Fi, Bluetooth, mobile data, hotspot, display, sound, battery saver, location, airplane mode, accessibility and JARVIS permissions. Android keeps connectivity and location switches under your direct control."
    }
}

/** Android adapter: connectivity and location switches are never toggled programmatically. */
class AndroidLocalSystemPlatform(context: Context) : LocalSystemPlatform {
    private val appContext = context.applicationContext
    private val audioManager: AudioManager
        get() = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    override fun readSnapshot(): DeviceSystemSnapshot {
        val batteryIntent = appContext.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val batteryPercent = if (level >= 0 && scale > 0) ((level * 100f) / scale).toInt().coerceIn(0, 100) else null
        val batteryStatus = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = when (batteryStatus) {
            BatteryManager.BATTERY_STATUS_CHARGING, BatteryManager.BATTERY_STATUS_FULL -> true
            BatteryManager.BATTERY_STATUS_DISCHARGING, BatteryManager.BATTERY_STATUS_NOT_CHARGING -> false
            else -> null
        }
        val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC).coerceIn(0, maxVolume)
        val volumePercent = ((currentVolume * 100f) / maxVolume).toInt().coerceIn(0, 100)
        return DeviceSystemSnapshot(batteryPercent, charging, readNetworkLabel(), volumePercent)
    }

    override fun increaseMediaVolume() {
        audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
    }

    override fun decreaseMediaVolume() {
        audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
    }

    override fun muteMediaVolume() {
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, 0, AudioManager.FLAG_SHOW_UI)
    }

    override fun unmuteMediaVolume() {
        val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        if (audioManager.getStreamVolume(AudioManager.STREAM_MUSIC) == 0) {
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, (maxVolume / 3).coerceAtLeast(1), AudioManager.FLAG_SHOW_UI)
        } else {
            audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI)
        }
    }

    override fun setMediaVolume(percent: Int) {
        require(percent in 0..100)
        val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val target = ((maxVolume * percent) / 100f).toInt().coerceIn(0, maxVolume)
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, AudioManager.FLAG_SHOW_UI)
    }

    override fun openSettings(target: SystemSettingsTarget): Boolean {
        val intent = when (target) {
            SystemSettingsTarget.GENERAL -> Intent(Settings.ACTION_SETTINGS)
            SystemSettingsTarget.WIFI -> Intent(Settings.ACTION_WIFI_SETTINGS)
            SystemSettingsTarget.WIRELESS -> Intent(Settings.ACTION_WIRELESS_SETTINGS)
            SystemSettingsTarget.BLUETOOTH -> Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
            SystemSettingsTarget.DISPLAY -> Intent(Settings.ACTION_DISPLAY_SETTINGS)
            SystemSettingsTarget.SOUND -> Intent(Settings.ACTION_SOUND_SETTINGS)
            SystemSettingsTarget.BATTERY -> Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)
            SystemSettingsTarget.LOCATION -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            SystemSettingsTarget.AIRPLANE_MODE -> Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)
            SystemSettingsTarget.ACCESSIBILITY -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            SystemSettingsTarget.APP_PERMISSIONS -> Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", appContext.packageName, null)
            )
            SystemSettingsTarget.APP_NOTIFICATIONS -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra("android.provider.extra.APP_PACKAGE", appContext.packageName)
            }
            SystemSettingsTarget.HOTSPOT -> Intent("android.settings.TETHER_SETTINGS")
        }
        return try {
            appContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: SecurityException) {
            false
        }
    }

    private fun readNetworkLabel(): String {
        return try {
            val manager = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = manager.activeNetwork ?: return "not connected"
            val capabilities = manager.getNetworkCapabilities(network) ?: return "network status unavailable"
            val transport = when {
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "mobile network"
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
                else -> "network"
            }
            if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                transport + " connected"
            } else {
                transport + " connected; internet not verified"
            }
        } catch (_: SecurityException) {
            "network status unavailable"
        } catch (_: Exception) {
            "network status unavailable"
        }
    }
}
