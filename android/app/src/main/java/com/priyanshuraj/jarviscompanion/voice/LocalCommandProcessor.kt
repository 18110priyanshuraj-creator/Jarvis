package com.priyanshuraj.jarviscompanion.voice

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.priyanshuraj.jarviscompanion.accessibility.JarvisAccessibilityService
import com.priyanshuraj.jarviscompanion.accessibility.ScreenObserver
import com.priyanshuraj.jarviscompanion.accessibility.UIActionExecutor
import java.util.Locale

object LocalCommandProcessor {
    private val openPrefix = Regex("""^(?:please\s+)?(?:open|launch|start)\s+(.+)$""", RegexOption.IGNORE_CASE)
    private val openSuffix = Regex("""^(.+?)\s+(?:kholo|khol do|open karo|chalu karo)$""", RegexOption.IGNORE_CASE)
    private val tapPrefix = Regex("""^(?:tap|click|press|select|dabao)\s+(.+)$""", RegexOption.IGNORE_CASE)
    private val tapSuffix = Regex("""^(.+?)\s+par\s+(?:tap|click|dabao)\s+karo$""", RegexOption.IGNORE_CASE)
    private val typePrefix = Regex("""^(?:type|enter text|likho|text likho)\s+(.+)$""", RegexOption.IGNORE_CASE)

    fun isStopCommand(message: String): Boolean {
        val value = normalize(message)
        return value in setOf(
            "stop listening", "stop hands free", "stop hands-free",
            "jarvis stop", "sunna band karo", "listening band karo"
        )
    }

    /**
     * Handles simple local actions. Screen actions are allowed only during the
     * explicit hands-free session, when another app can remain in the foreground.
     */
    fun handle(context: Context, message: String, allowUiActions: Boolean): String? {
        val original = message.trim()
        if (original.isBlank()) return null

        if (normalize(original) == "open home screen") {
            if (!allowUiActions) return "Use the Home command during hands-free control."
            val active = JarvisAccessibilityService.activeService
                ?: return "Enable the JARVIS screen assistant in Android Accessibility settings first."
            return UIActionExecutor.goHome(active).message
        }

        val appName = openPrefix.find(original)?.groupValues?.getOrNull(1)
            ?: openSuffix.find(original)?.groupValues?.getOrNull(1)
        if (!appName.isNullOrBlank()) return launchInstalledApp(context, cleanQuoted(appName))

        if (!allowUiActions) return null

        val lower = normalize(original)
        val service = JarvisAccessibilityService.activeService

        if (lower in setOf(
                "read screen", "read the screen", "what is on screen", "what's on screen",
                "screen batao", "kya dikh raha hai", "screen par kya hai"
            )) {
            val active = service
                ?: return "Enable the JARVIS screen assistant in Android Accessibility settings first."
            val summary = ScreenObserver.describe(active.rootInActiveWindow)
            return "Here is the local screen summary. This content is not sent to the JARVIS server.\n" + summary
        }

        if (lower in setOf("scroll down", "scroll neeche", "neeche scroll", "down scroll", "neeche karo")) {
            val active = service
                ?: return "Enable the JARVIS screen assistant in Android Accessibility settings first."
            return UIActionExecutor.scroll(active, forward = true).message
        }
        if (lower in setOf("scroll up", "scroll upar", "upar scroll", "up scroll", "upar karo")) {
            val active = service
                ?: return "Enable the JARVIS screen assistant in Android Accessibility settings first."
            return UIActionExecutor.scroll(active, forward = false).message
        }
        if (lower in setOf("back", "go back", "press back", "peeche jao", "wapas jao")) {
            val active = service
                ?: return "Enable the JARVIS screen assistant in Android Accessibility settings first."
            return UIActionExecutor.goBack(active).message
        }
        if (lower in setOf("home", "go home", "home screen", "open home screen", "ghar jao")) {
            val active = service
                ?: return "Enable the JARVIS screen assistant in Android Accessibility settings first."
            return UIActionExecutor.goHome(active).message
        }

        val tapLabel = tapPrefix.find(original)?.groupValues?.getOrNull(1)
            ?: tapSuffix.find(original)?.groupValues?.getOrNull(1)
        if (!tapLabel.isNullOrBlank()) {
            val active = service
                ?: return "Enable the JARVIS screen assistant in Android Accessibility settings first."
            val cleanLabel = cleanQuoted(tapLabel)
                .removePrefix("the ")
                .removeSuffix(" button")
                .trim()
            return UIActionExecutor.clickExactLabel(active, cleanLabel).message
        }

        val text = typePrefix.find(original)?.groupValues?.getOrNull(1)
        if (!text.isNullOrBlank()) {
            val active = service
                ?: return "Enable the JARVIS screen assistant in Android Accessibility settings first."
            return UIActionExecutor.typeIntoFocusedField(active, text).message
        }

        return null
    }

    private fun launchInstalledApp(context: Context, requestedName: String): String {
        val query = normalize(requestedName)
        if (query.isBlank()) return "Tell me which app to open."

        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val activities = queryLauncherActivities(context.packageManager, launcherIntent)
        val apps = activities.mapNotNull { item ->
            val info = item.activityInfo ?: return@mapNotNull null
            AppEntry(
                packageName = info.packageName,
                className = info.name,
                label = item.loadLabel(context.packageManager)?.toString()?.trim().orEmpty()
            )
        }.filter { it.label.isNotBlank() }.distinctBy { it.packageName }

        val exactMatches = apps.filter { normalize(it.label) == query }
        val candidates = if (exactMatches.isNotEmpty()) exactMatches else apps.filter {
            normalize(it.label).startsWith(query)
        }

        if (candidates.isEmpty()) {
            return "I could not find an installed app named " + requestedName + "."
        }
        if (candidates.size > 1) {
            return "More than one app matches. Say its full app name: " +
                candidates.take(5).joinToString(", ") { it.label } + "."
        }

        val selected = candidates.first()
        return try {
            val intent = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_LAUNCHER)
                component = ComponentName(selected.packageName, selected.className)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            "Opening " + selected.label + "."
        } catch (_: Exception) {
            "Android could not open " + selected.label + ". Check that the app is installed and enabled."
        }
    }

    @Suppress("DEPRECATION")
    private fun queryLauncherActivities(
        packageManager: PackageManager,
        intent: Intent
    ) = if (Build.VERSION.SDK_INT >= 33) {
        packageManager.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
    } else {
        packageManager.queryIntentActivities(intent, 0)
    }

    private fun cleanQuoted(value: String): String =
        value.trim().trim('"', '\'').trim()

    private fun normalize(value: String): String =
        value.lowercase(Locale.ROOT).replace(Regex("""\s+"""), " ").trim()

    private data class AppEntry(
        val packageName: String,
        val className: String,
        val label: String
    )
}
