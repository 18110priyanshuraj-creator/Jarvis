package com.priyanshuraj.jarviscompanion.voice

import java.net.URI
import java.util.Locale

/**
 * Accepts only ordinary public web URLs for explicit user-requested browser launches.
 * Credentials, local/private hosts and non-web schemes are rejected.
 */
object BrowserUrlPolicy {
    fun normalize(raw: String): String? {
        val input = raw.trim().trim('"', '\'')
        if (input.isBlank() || input.length > 2048 || input.any { it.isISOControl() }) return null
        val candidate = if (input.contains("://")) input else "https://$input"
        val uri = runCatching { URI(candidate).normalize() }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        val host = uri.host?.lowercase(Locale.ROOT) ?: return null
        if (scheme !in setOf("http", "https")) return null
        if (uri.userInfo != null || host.isBlank() || host == "localhost" ||
            host.endsWith(".localhost") || host == "127.0.0.1" || host == "::1" ||
            host.startsWith("10.") || host.startsWith("192.168.") ||
            host.matches(Regex("""172\.(1[6-9]|2[0-9]|3[0-1])\..+""")) ||
            host.endsWith(".local") || host.endsWith(".internal")) return null
        if (uri.port !in -1..65535) return null
        return uri.toASCIIString()
    }
}
