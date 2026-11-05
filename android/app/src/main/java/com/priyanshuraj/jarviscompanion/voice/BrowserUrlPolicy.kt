package com.priyanshuraj.jarviscompanion.voice

import java.net.URI
import java.util.Locale

/**
 * Accepts only ordinary public web URLs for explicit user-requested browser launches.
 * Credentials, local/private hosts and non-web schemes are rejected. This is an intent
 * safety check, not a server-side URL fetcher or a guarantee about a site's DNS records.
 */
object BrowserUrlPolicy {
    private fun isPrivateOrReservedIpv4(host: String): Boolean {
        val parts = host.split(".")
        if (parts.size != 4 || parts.any { it.isEmpty() || !it.all(Char::isDigit) }) return false

        // Reject ambiguous octal-looking address forms rather than relying on how a
        // particular browser parses leading-zero IPv4 components.
        if (parts.any { it.length > 1 && it.startsWith("0") }) return true
        val octets = parts.map { it.toIntOrNull() ?: return true }
        if (octets.any { it !in 0..255 }) return true

        val a = octets[0]
        val b = octets[1]
        val c = octets[2]
        return a == 0 || a == 10 || a == 127 || a >= 224 ||
            (a == 100 && b in 64..127) ||
            (a == 169 && b == 254) ||
            (a == 172 && b in 16..31) ||
            (a == 192 && b == 0) ||
            (a == 192 && b == 0 && c == 2) ||
            (a == 192 && b == 88 && c == 99) ||
            (a == 192 && b == 168) ||
            (a == 198 && b in 18..19) ||
            (a == 198 && b == 51 && c == 100) ||
            (a == 203 && b == 0 && c == 113)
    }

    fun normalize(raw: String): String? {
        val input = raw.trim().trim('"', '\'')
        if (input.isBlank() || input.length > 2048 || input.any { it.isISOControl() }) return null
        if (!input.contains("://") && Regex("""^[a-zA-Z][a-zA-Z0-9+.-]*:""").containsMatchIn(input)) return null
        val candidate = if (input.contains("://")) input else "https://$input"
        val uri = runCatching { URI(candidate).normalize() }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        val host = uri.host?.lowercase(Locale.ROOT) ?: return null
        if (scheme !in setOf("http", "https")) return null
        if (uri.userInfo != null || host.isBlank() || host.endsWith(".")) return null

        // Disallow IPv6 literals in this browser handoff path. Public IPv6 can be
        // added later with a dedicated global-unicast range check.
        if (host.contains(':') || host == "localhost" || host.endsWith(".localhost") ||
            host.endsWith(".local") || host.endsWith(".internal") ||
            host.endsWith(".test") || host.endsWith(".example") ||
            host.endsWith(".invalid") || host.endsWith(".onion") ||
            isPrivateOrReservedIpv4(host)) return null

        if (!host.contains(".")) return null
        if (uri.port !in -1..65535) return null

        val normalized = uri.toASCIIString()
        if (!uri.rawPath.isNullOrEmpty()) return normalized

        // URI.toASCIIString() omits the implicit root slash. Add it before any
        // query or fragment so bare domains have one stable browser URL form.
        val authorityStart = normalized.indexOf("://") + 3
        if (authorityStart < 3) return null
        val suffixStart = listOf(
            normalized.indexOf('?', authorityStart),
            normalized.indexOf('#', authorityStart)
        ).filter { it >= 0 }.minOrNull() ?: normalized.length
        return normalized.substring(0, suffixStart) + "/" + normalized.substring(suffixStart)
    }
}
