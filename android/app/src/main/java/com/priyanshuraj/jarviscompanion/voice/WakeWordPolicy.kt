package com.priyanshuraj.jarviscompanion.voice

import java.text.Normalizer
import java.util.Locale

/**
 * Parses an explicit wake phrase inside the user-started foreground microphone session.
 * This is not an always-on service: Android's visible foreground notification and user stop
 * control remain required for the session lifetime.
 */
object WakeWordPolicy {
    private val wakePrefix = Regex(
        """^\s*(?:(?:hey|okay|ok|hello|hi)\s+)?jarvis\b(?:\s*[,;:]\s*|\s+|$)""",
        RegexOption.IGNORE_CASE
    )

    /**
     * Returns the command after "JARVIS", or null when the phrase was not spoken.
     * An empty string means the wake phrase was spoken by itself and the service may prompt.
     */
    fun commandAfterWakeWord(transcript: String): String? {
        val clean = Normalizer.normalize(transcript, Normalizer.Form.NFKC).trim()
        if (clean.isBlank()) return null
        val match = wakePrefix.find(clean) ?: return null
        return clean.substring(match.range.last + 1)
            .trim()
            .trimStart(',', ';', ':', '-', '—')
            .trim()
            .take(2000)
    }
}
