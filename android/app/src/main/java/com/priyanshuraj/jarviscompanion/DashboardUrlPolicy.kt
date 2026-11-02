package com.priyanshuraj.jarviscompanion

import java.net.URI
import java.util.Locale

/**
 * Restricts the embedded workspace to the configured HTTPS origin and the
 * Google-owned hosts required by the existing Google OAuth flow.
 */
internal object DashboardUrlPolicy {
    fun normalizeBaseUrl(rawUrl: String?): String? {
        val value = rawUrl?.trim()?.takeIf { it.isNotEmpty() && it.length <= 2048 } ?: return null
        val uri = parseHttpsUri(value) ?: return null
        if (uri.userInfo != null || uri.query != null || uri.fragment != null) return null
        if (uri.port != -1 && uri.port != 443) return null
        if (uri.path.isNotEmpty() && uri.path != "/") return null
        val host = uri.host?.lowercase(Locale.ROOT) ?: return null
        return try {
            URI("https", null, host, -1, null, null, null).toASCIIString()
        } catch (_: Exception) {
            null
        }
    }

    fun allowsInAppNavigation(rawUrl: String?, configuredBaseUrl: String?): Boolean {
        val target = rawUrl?.let(::parseHttpsUri) ?: return false
        val base = normalizeBaseUrl(configuredBaseUrl) ?: return false
        if (target.userInfo != null || (target.port != -1 && target.port != 443)) return false

        val targetHost = target.host?.lowercase(Locale.ROOT) ?: return false
        val baseHost = URI(base).host?.lowercase(Locale.ROOT) ?: return false
        if (targetHost == baseHost) return true

        return targetHost == "google.com" ||
            targetHost.endsWith(".google.com") ||
            targetHost.endsWith(".googleapis.com")
    }

    fun isSafeExternalHttpsUrl(rawUrl: String?): Boolean {
        val uri = rawUrl?.let(::parseHttpsUri) ?: return false
        return uri.userInfo == null && (uri.port == -1 || uri.port == 443)
    }

    private fun parseHttpsUri(value: String): URI? {
        return try {
            val uri = URI(value)
            if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) null else uri
        } catch (_: Exception) {
            null
        }
    }
}
