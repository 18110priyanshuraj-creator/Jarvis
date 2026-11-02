package com.priyanshuraj.jarviscompanion.accessibility

import java.util.Locale

/**
 * Redacts common account identifiers and bounds the text returned from a one-shot screen read.
 * This helper is pure Kotlin so the privacy rules can be covered by JVM unit tests.
 */
internal object ScreenObservationText {
    private const val MAX_LINES = 32
    private const val MAX_CHARS = 1800

    private val sensitiveValue = Regex(
        """(?i)\b(password|passcode|pin|otp|one[- ]time (?:password|code)|verification code|security code|recovery code)\b\s*[:#-]?\s*[\p{L}\p{N}][\p{L}\p{N}-]{2,}"""
    )
    private val emailAddress = Regex("""(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b""")
    private val separatedNumber = Regex("""(?<![A-Za-z0-9])\+?\d[\d\s().-]{7,}\d(?![A-Za-z0-9])""")
    private val longNumber = Regex("""(?<!\d)\d{4,10}(?!\d)""")
    private val whitespace = Regex("""\s+""")
    private val protectedScreenLabel = Regex(
        """(?i)\b(password|passcode|pin|otp|one[- ]time (?:password|code)|verification code|security code|recovery code|cvv|cvc)\b"""
    )

    fun containsProtectedScreenLabel(lines: Iterable<String>): Boolean =
        lines.any { protectedScreenLabel.containsMatchIn(it) }


    fun format(accessibilityText: String, visualLines: Iterable<String>): String {
        val accessible = cleanLines(accessibilityText.lineSequence())
        val visual = cleanLines(visualLines.asSequence())
            .filterNot { candidate ->
                accessible.any { normalize(it) == normalize(candidate) }
            }

        val output = mutableListOf<String>()
        if (visual.isNotEmpty()) {
            output += "Visible text (one-time on-device OCR):"
            output += visual.map { "• " + it }
        }
        if (accessible.isNotEmpty()) {
            output += "Accessible labels:"
            output += accessible.map { "• " + it }
        }
        if (output.isEmpty()) {
            return "I could not find readable text or accessible labels on this screen."
        }

        val bounded = output.take(MAX_LINES)
        val text = bounded.joinToString("\n")
        return if (text.length > MAX_CHARS) {
            text.take(MAX_CHARS - 1).trimEnd() + "…"
        } else {
            text
        }
    }

    private fun cleanLines(source: Sequence<String>): List<String> {
        val seen = linkedSetOf<String>()
        val result = mutableListOf<String>()
        for (raw in source) {
            val cleaned = sanitize(raw)
            if (cleaned.isBlank()) continue
            if (cleaned.equals("Accessible labels:", ignoreCase = true) ||
                cleaned.startsWith("Visible text (one-time on-device OCR):", ignoreCase = true)
            ) continue
            val key = normalize(cleaned)
            if (seen.add(key)) result += cleaned.take(180)
            if (result.size >= MAX_LINES) break
        }
        return result
    }

    private fun sanitize(raw: String): String {
        var value = raw.filter { !it.isISOControl() || it == '\t' }
        value = value.replace(sensitiveValue) { match ->
            match.groupValues[1] + ": [hidden]"
        }
        value = value.replace(emailAddress, "[email hidden]")
        value = value.replace(separatedNumber) { match ->
            if (match.value.count { it.isDigit() } >= 8) "[number hidden]" else match.value
        }
        value = value.replace(longNumber, "••••")
        return whitespace.replace(value, " ").trim().trimStart('•', '-', ' ')
    }

    private fun normalize(value: String): String =
        whitespace.replace(value.lowercase(Locale.ROOT), " ").trim()
}
