package com.priyanshuraj.jarviscompanion.voice

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import com.priyanshuraj.jarviscompanion.accessibility.JarvisAccessibilityService
import com.priyanshuraj.jarviscompanion.accessibility.ScreenObserver
import com.priyanshuraj.jarviscompanion.accessibility.UIActionExecutor
import com.priyanshuraj.jarviscompanion.accessibility.UiActionPolicy
import java.util.Locale

object LocalCommandProcessor {
    private val restrictedPublicSearch = Regex(
        """(?i)\b(porn|xxx|adult content|vape|cigarette|tobacco|nicotine|alcohol|liquor|beer|wine|weed|marijuana|cannabis|cocaine|methamphetamine|steroids|gambling|sports betting|casino|firearms?|weapons?|ammunition|how to make a bomb|explosives?|gun|suicide|self.?harm)\b"""
    )
    private val googleSearchPatterns = listOf(
        Regex("""^(?:please\s+)?search\s+(.+?)\s+(?:on|using)\s+google$""", RegexOption.IGNORE_CASE),
        Regex("""^(?:please\s+)?google\s+search\s+(?:for\s+)?(.+)$""", RegexOption.IGNORE_CASE),
        Regex("""^google\s+(?:par|pe)\s+(.+?)\s+(?:search|research)(?:\s+(?:karo|kar do))?$""", RegexOption.IGNORE_CASE),
        Regex("""^google\s+se\s+(.+?)\s+(?:search|dhundo|dhoondo)(?:\s+(?:karo|kar do))?$""", RegexOption.IGNORE_CASE),
        Regex("""^(?:internet|web)\s+(?:par|pe)\s+(.+?)\s+(?:search|research|check)(?:\s+(?:karo|kar do))?$""", RegexOption.IGNORE_CASE)
    )

    /**
     * Local-only public search intent parser. It returns a plan, never launches the
     * browser directly; the shared Android approval dialog remains mandatory.
     */
    fun createGoogleSearchPlan(message: String): JSONObject? {
        val input = normalizeCommand(message)
        if (input.isBlank()) return null

        val query = googleSearchPatterns.firstNotNullOfOrNull { pattern ->
            pattern.find(input)?.groupValues?.getOrNull(1)?.trim()
        }?.trim('"', '\'', '“', '”', '‘', '’')
            ?.replace(Regex("""\s+"""), " ")
            ?.trim()
            ?: return null

        val safe = query.isNotBlank() &&
            query.length <= 120 &&
            UiActionPolicy.validateTextPayload(query, 120).allowed &&
            !restrictedPublicSearch.containsMatchIn(query) &&
            !Regex("""(?i)\b(password|passcode|otp|one.?time code|pin|cvv|cvc|bank account|card number)\b""")
                .containsMatchIn(query)

        if (!safe) {
            return JSONObject()
                .put("mode", "clarification")
                .put("reply", "That search request is outside JARVIS's safe public-research scope. Choose a different educational topic.")
                .put("actions", JSONArray())
        }

        val actions = JSONArray()
            .put(JSONObject()
                .put("type", "open_web_search")
                .put("value", query)
                .put("purpose", "Open a fixed Google HTTPS search URL in the default browser."))
            .put(JSONObject()
                .put("type", "verify_browser_foreground")
                .put("value", query)
                .put("purpose", "Verify that Android's default browser is foregrounded."))
            .put(JSONObject()
                .put("type", "ask_user")
                .put("value", "The default browser opened for your Google search request. Check that the query loaded, then choose a public result yourself. Handle login, consent or CAPTCHA prompts manually.")
                .put("purpose", "Keep result selection and access challenges under the user's control."))

        return JSONObject()
            .put("mode", "device_action")
            .put("reply", "I will open Google in your default browser and verify that the browser is foregrounded. You will choose a result; JARVIS will not sign in, submit forms or bypass challenges.")
            .put("actions", actions)
    }

    private val openPrefix = Regex(
        """^(?:(?:please|can you)\s+)?(?:open|launch|start|run|visit|browse|go to|navigate to|take me to|chalao)\s+(.+)$""",
        RegexOption.IGNORE_CASE
    )
    private val websiteSuffix = Regex(
        """^(.+?)\s+(?:website|site)\s+(?:kholo|khol do|open karo)$""",
        RegexOption.IGNORE_CASE
    )
    private val websitePrefix = Regex(
        """^(?:website|site)\s+(?:kholo|khol do|open karo)\s+(.+)$""",
        RegexOption.IGNORE_CASE
    )
    private val openSuffix = Regex(
        """^(?:mujhe\s+)?(.+?)\s+(?:ko\s+)?(?:kholo|khol do|open karo|launch karo|chalao|start karo|shuru karo|chalu karo)$""",
        RegexOption.IGNORE_CASE
    )
    private val tapPrefix = Regex("""^(?:tap|click|press|select|dabao)\s+(.+)$""", RegexOption.IGNORE_CASE)
    private val tapSuffix = Regex("""^(.+?)\s+par\s+(?:tap|click|dabao)\s+karo$""", RegexOption.IGNORE_CASE)
    private val typePrefix = Regex("""^(?:type|enter text|likho|text likho)\s+(.+)$""", RegexOption.IGNORE_CASE)

    fun isScreenObservationCommand(message: String): Boolean {
        val value = normalize(message.replace('’', '\''))
        return value in setOf(
            "read screen", "read the screen", "read my screen", "please read the screen",
            "what is on screen", "what's on screen", "what is on my screen", "what's on my screen",
            "tell me what is on screen", "please describe my screen",
            "screen batao", "kya dikh raha hai", "screen par kya hai",
            "describe screen", "describe the screen", "describe my screen",
            "read visible text", "what does this page say", "page read karo",
            "screen pe kya likha hai", "screen par kya likha hai", "screen ko padh kar batao"
        )
    }

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
    /**
     * Remove an optional spoken wake word before matching local commands.
     * Without this, requests such as "Jarvis, open Canva" miss the direct
     * app-launch parser and are unnecessarily sent to remote planning.
     */
    internal fun normalizeCommand(message: String): String =
        message.trim()
            .replace(Regex("""(?i)^(?:(?:hey|okay|ok|hello|hi)\s+)?jarvis(?:[\s,:;-]+|$)"""), "")
            .trim()
            .trimEnd('.', '!', '?', '।', '॥')

    /** Return the app target for common English and Hindi launch phrasings. */
    internal fun appLaunchTarget(message: String): String? {
        val input = normalizeCommand(message)
        val rawTarget = openPrefix.find(input)?.groupValues?.getOrNull(1)
            ?: websiteSuffix.find(input)?.groupValues?.getOrNull(1)
            ?: websitePrefix.find(input)?.groupValues?.getOrNull(1)
            ?: openSuffix.find(input)?.groupValues?.getOrNull(1)
            ?: return null
        // Remove polite/context clauses so "open Canva to edit a video" still
        // resolves to the app name rather than searching for a fictitious app.
        return rawTarget
            .replace(Regex("""(?i)\s+(?:to|for|and|then|because|so|please)\b.*$"""), "")
            .trim()
            .trimEnd('.', '!', '?', '।', '॥')
            .ifBlank { null }
    }

    fun handle(context: Context, message: String, allowUiActions: Boolean): String? {
        val original = normalizeCommand(message)
        if (original.isBlank()) return null

        if (normalize(original) == "open home screen") {
            if (!allowUiActions) return "Use the Home command during hands-free control."
            val active = JarvisAccessibilityService.activeService
                ?: return "Enable the JARVIS screen assistant in Android Accessibility settings first."
            return UIActionExecutor.goHome(active).message
        }

        val appName = appLaunchTarget(original)
        if (!appName.isNullOrBlank()) {
            val website = BrowserUrlPolicy.normalize(appName)
            if (website != null) {
                if (!allowUiActions) return "Start JARVIS hands-free control before opening a website."
                return openWebsite(context, website)
            }
            val composite = Regex("""\b(and|then|after|aur|phir)\b""", RegexOption.IGNORE_CASE)
            if (composite.containsMatchIn(appName)) return null
            return launchInstalledApp(context, cleanQuoted(appName))
        }

        if (!allowUiActions) return null

        val lower = normalize(original)
        val service = JarvisAccessibilityService.activeService

        if (isScreenObservationCommand(original)) {
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


    private fun openWebsite(context: Context, url: String): String {
        return try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            "Opened " + url + " in your default browser. JARVIS will wait for your next instruction before interacting with the page."
        } catch (_: Exception) {
            "Android could not open that website. Check that a default browser is installed."
        }
    }

    data class PlannedActionResult(
        val success: Boolean,
        val shouldStop: Boolean,
        val message: String
    )

    fun executePlannedAction(
        context: Context,
        type: String,
        value: String,
        sourceLabel: String = "",
        targetLabel: String = ""
    ): PlannedActionResult {
        val service = JarvisAccessibilityService.activeService
        return when (type) {
            "open_app" -> {
                val result = launchInstalledApp(context, cleanQuoted(value))
                val failed = result.startsWith("I could not find") ||
                    result.startsWith("More than one app") ||
                    result.startsWith("Android could not open")
                PlannedActionResult(!failed, failed, result)
            }
            "read_screen" -> {
                if (service == null) PlannedActionResult(false, true, "Enable the JARVIS screen assistant in Android Accessibility settings first.")
                else PlannedActionResult(true, true, "Current screen, read locally: " + ScreenObserver.describe(service.rootInActiveWindow))
            }
            "tap_label" -> {
                if (service == null) PlannedActionResult(false, true, "Enable the JARVIS screen assistant in Android Accessibility settings first.")
                else {
                    val result = UIActionExecutor.clickExactLabel(service, value)
                    PlannedActionResult(result.ok, !result.ok, result.message)
                }
            }
            "type_text" -> {
                if (service == null) PlannedActionResult(false, true, "Enable the JARVIS screen assistant in Android Accessibility settings first.")
                else {
                    val result = UIActionExecutor.typeIntoFocusedField(service, value)
                    PlannedActionResult(result.ok, !result.ok, result.message)
                }
            }
            "scroll_down", "scroll_up" -> {
                if (service == null) PlannedActionResult(false, true, "Enable the JARVIS screen assistant in Android Accessibility settings first.")
                else {
                    val result = UIActionExecutor.scroll(service, forward = type == "scroll_down")
                    PlannedActionResult(result.ok, !result.ok, result.message)
                }
            }
            "back" -> {
                if (service == null) PlannedActionResult(false, true, "Enable the JARVIS screen assistant in Android Accessibility settings first.")
                else {
                    val result = UIActionExecutor.goBack(service)
                    PlannedActionResult(result.ok, !result.ok, result.message)
                }
            }
            "home" -> {
                if (service == null) PlannedActionResult(false, true, "Enable the JARVIS screen assistant in Android Accessibility settings first.")
                else {
                    val result = UIActionExecutor.goHome(service)
                    PlannedActionResult(result.ok, !result.ok, result.message)
                }
            }
            "open_web_search" -> openGoogleSearch(context, value)
            "verify_browser_foreground" -> verifyBrowserForeground(context, value)
            "open_public_url" -> openPublicUrl(context, value)
            "verify_public_url_foreground" -> verifyPublicUrlForeground(context, value)
            "verify_app_foreground" -> verifyAppForeground(context, value)
            "drag_label_to_label" -> {
                // The planner binds this action to Canva and the check is repeated at
                // execution time so a foreground-app switch cannot redirect the drag.
                val appCheck = verifyAppForeground(context, value)
                if (!appCheck.success || appCheck.shouldStop) {
                    appCheck
                } else if (service == null) {
                    PlannedActionResult(false, true, "Enable the JARVIS screen assistant in Android Accessibility settings first.")
                } else {
                    val result = UIActionExecutor.dragExactLabels(service, sourceLabel, targetLabel)
                    PlannedActionResult(result.ok, !result.ok, result.message)
                }
            }
            "verify_screen_text" -> {
                if (service == null) {
                    PlannedActionResult(
                        true, true,
                        "JARVIS cannot verify the visible result without its user-enabled Accessibility service. No later actions were run."
                    )
                } else {
                    val result = UIActionExecutor.verifyVisibleText(service, value)
                    if (result.ok) {
                        PlannedActionResult(true, false, result.message)
                    } else {
                        PlannedActionResult(
                            true, true,
                            "The requested result is not verified. " + result.message + " No later actions were run."
                        )
                    }
                }
            }
            "ask_user" -> PlannedActionResult(true, true, value)
            "finish" -> PlannedActionResult(true, true, value)
            else -> PlannedActionResult(false, true, "JARVIS rejected an unsupported action.")
        }
    }


    private fun openPublicUrl(context: Context, rawUrl: String): PlannedActionResult {
        val normalized = BrowserUrlPolicy.normalize(rawUrl)
            ?: return PlannedActionResult(
                false, true,
                "JARVIS rejected this website because it is not a safe public HTTP or HTTPS address."
            )
        val uri = Uri.parse(normalized)
        val intent = Intent(Intent.ACTION_VIEW, uri)
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            PlannedActionResult(
                true, false,
                "Opened the requested public website in Android's default browser. JARVIS has not signed in, submitted a form or interacted with the page."
            )
        } catch (_: Exception) {
            PlannedActionResult(
                false, true,
                "Android could not open the website. Check that a default browser is available."
            )
        }
    }

    private fun verifyPublicUrlForeground(context: Context, rawUrl: String): PlannedActionResult {
        val service = JarvisAccessibilityService.activeService
            ?: return PlannedActionResult(
                false, true,
                "The website handoff happened, but JARVIS cannot verify the browser without its user-enabled Accessibility service. Check the browser manually."
            )
        val normalized = BrowserUrlPolicy.normalize(rawUrl)
            ?: return PlannedActionResult(false, true, "The public website address failed its safety check.")
        val uri = Uri.parse(normalized)
        val viewIntent = Intent(Intent.ACTION_VIEW, uri)
            .addCategory(Intent.CATEGORY_BROWSABLE)
        val expectedPackage = resolveViewActivity(context.packageManager, viewIntent)
            ?.activityInfo
            ?.packageName
            .orEmpty()
        if (expectedPackage.isBlank() ||
            expectedPackage in setOf("android", "com.android.intentresolver", "com.android.systemui")
        ) {
            return PlannedActionResult(
                false, true,
                "Android has no unique default browser selected. Set a default browser in Android Settings and retry. JARVIS will not choose a browser or bypass the system chooser."
            )
        }
        val root = service.rootInActiveWindow
            ?: return PlannedActionResult(false, true, "The browser window is not available to JARVIS yet. Check it manually.")
        val foregroundPackage = try {
            root.packageName?.toString()?.trim().orEmpty()
        } finally {
            runCatching { root.recycle() }
        }
        return if (foregroundPackage == expectedPackage) {
            PlannedActionResult(
                true, false,
                "JARVIS verified that the selected browser app is in the foreground. It has not verified page content or read the website yet."
            )
        } else {
            PlannedActionResult(
                false, true,
                "The expected browser is not in the foreground. Check the website manually; no later steps were run."
            )
        }
    }

    private fun openGoogleSearch(context: Context, rawQuery: String): PlannedActionResult {
        val query = rawQuery.trim()
        if (query.isBlank() || query.length > 120) {
            return PlannedActionResult(false, true, "Enter a short Google search phrase.")
        }
        if (!UiActionPolicy.validateTextPayload(query, 120).allowed ||
            Regex("""(?i)\b(porn|xxx|adult content|vape|cigarette|tobacco|nicotine|alcohol|liquor|beer|wine|weed|marijuana|cannabis|cocaine|methamphetamine|steroids|gambling|sports betting|casino|firearms?|weapons?|ammunition|how to make a bomb|explosives?|gun|suicide|self.?harm)\b""")
                .containsMatchIn(query)
        ) {
            return PlannedActionResult(false, true, "This search phrase is outside JARVIS's safe public-research policy.")
        }

        val searchUri = Uri.parse("https://www.google.com/search")
            .buildUpon()
            .appendQueryParameter("q", query)
            .build()
        return try {
            val intent = Intent(Intent.ACTION_VIEW, searchUri)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            PlannedActionResult(
                true, false,
                "Opened Google in the default browser. JARVIS has not selected a result or submitted a form."
            )
        } catch (_: Exception) {
            PlannedActionResult(
                false, true,
                "Android could not open the default browser. Check that a browser is available and try again."
            )
        }
    }

    private fun verifyBrowserForeground(context: Context, rawQuery: String): PlannedActionResult {
        val service = JarvisAccessibilityService.activeService
            ?: return PlannedActionResult(
                true, true,
                "Google was opened, but JARVIS cannot verify the browser without its user-enabled Accessibility service. Check the browser manually."
            )
        val query = rawQuery.trim()
        if (query.isBlank() || query.length > 120 ||
            !UiActionPolicy.validateTextPayload(query, 120).allowed ||
            Regex("""(?i)\b(porn|xxx|adult content|vape|cigarette|tobacco|nicotine|alcohol|liquor|beer|wine|weed|marijuana|cannabis|cocaine|methamphetamine|steroids|gambling|sports betting|casino|firearms?|weapons?|ammunition|how to make a bomb|explosives?|gun|suicide|self.?harm)\b""")
                .containsMatchIn(query)
        ) {
            return PlannedActionResult(true, true, "The browser handoff could not be safely verified. Check the screen manually.")
        }
        val root = service.rootInActiveWindow
            ?: return PlannedActionResult(true, true, "The browser window is not available to JARVIS yet. Check it manually.")
        val foregroundPackage = try {
            root.packageName?.toString()?.trim().orEmpty()
        } finally {
            runCatching { root.recycle() }
        }
        if (foregroundPackage.isBlank()) {
            return PlannedActionResult(true, true, "The foreground app identity is unavailable. The search is not marked complete.")
        }

        val searchUri = Uri.parse("https://www.google.com/search")
            .buildUpon()
            .appendQueryParameter("q", query)
            .build()
        val viewIntent = Intent(Intent.ACTION_VIEW, searchUri)
            .addCategory(Intent.CATEGORY_BROWSABLE)
        val expectedPackage = resolveViewActivity(context.packageManager, viewIntent)
            ?.activityInfo
            ?.packageName
            .orEmpty()
        if (expectedPackage.isBlank() ||
            expectedPackage in setOf("android", "com.android.intentresolver", "com.android.systemui")
        ) {
            return PlannedActionResult(
                true, true,
                "Android has no unique default browser selected. Set a default browser in Android Settings, then retry. JARVIS will not choose a browser or bypass the system chooser."
            )
        }
        return if (foregroundPackage == expectedPackage) {
            PlannedActionResult(
                true, false,
                "JARVIS verified that the selected browser app is in the foreground. It has not read or checked the Google results."
            )
        } else {
            PlannedActionResult(
                true, true,
                "Google was opened, but the expected browser is not in the foreground. Check the browser manually; no later steps were run."
            )
        }
    }

    @Suppress("DEPRECATION")
    private fun resolveViewActivity(packageManager: PackageManager, intent: Intent) =
        if (Build.VERSION.SDK_INT >= 33) {
            packageManager.resolveActivity(
                intent,
                PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong())
            )
        } else {
            packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        }

    private fun verifyAppForeground(context: Context, requestedName: String): PlannedActionResult {
        val service = JarvisAccessibilityService.activeService
            ?: return PlannedActionResult(
                true, true,
                "JARVIS cannot confirm which app is in the foreground without its user-enabled Accessibility service. No later actions were run."
            )
        val root = service.rootInActiveWindow
            ?: return PlannedActionResult(
                true, true,
                "JARVIS could not inspect the foreground app yet. Review the screen and reissue the task."
            )
        val foregroundPackage = try {
            root.packageName?.toString()?.trim().orEmpty()
        } finally {
            runCatching { root.recycle() }
        }
        if (foregroundPackage.isBlank()) {
            return PlannedActionResult(true, true, "The foreground app identity is unavailable. The task is not marked complete.")
        }

        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val matchingApps = queryLauncherActivities(context.packageManager, launcherIntent)
            .mapNotNull { item ->
                val info = item.activityInfo ?: return@mapNotNull null
                AppEntry(
                    packageName = info.packageName,
                    className = info.name,
                    label = item.loadLabel(context.packageManager)?.toString()?.trim().orEmpty()
                )
            }
            .filter { it.label.isNotBlank() && normalize(it.label) == normalize(requestedName) }
            .distinctBy { it.packageName }

        if (matchingApps.size != 1) {
            return PlannedActionResult(
                true, true,
                "JARVIS could not uniquely identify the requested installed app for verification. Please check the screen manually."
            )
        }
        val expected = matchingApps.single()
        return if (foregroundPackage == expected.packageName) {
            PlannedActionResult(true, false, "JARVIS verified that " + expected.label + " is the foreground app.")
        } else {
            PlannedActionResult(
                true, true,
                "Android opened an app, but JARVIS could not verify that " + expected.label + " is in the foreground. No later actions were run."
            )
        }
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
