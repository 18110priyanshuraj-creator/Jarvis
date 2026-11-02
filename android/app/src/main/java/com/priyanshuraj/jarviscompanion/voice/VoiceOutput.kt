package com.priyanshuraj.jarviscompanion.voice

import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import java.util.Locale

data class VoiceSelection(
    val languageTag: String,
    val localVoice: Boolean,
    val fallbackUsed: Boolean,
    val message: String,
    val available: Boolean = true
)

/**
 * Shared Android speech-output helpers. Prefer installed, on-device voices so
 * spoken replies do not need a network voice service when one is available.
 */
object VoiceOutput {
    fun configure(
        engine: TextToSpeech,
        preferredLanguageTag: String,
        offlineOnly: Boolean = false
    ): VoiceSelection {
        val requested = when (preferredLanguageTag) {
            "en-IN" -> Locale("en", "IN")
            else -> Locale("hi", "IN")
        }
        val voices = engine.voices.orEmpty()
        val preferredVoice = findVoice(voices, requested, offlineOnly)
        val fallbackLocale = if (requested.language == "hi") Locale("en", "IN") else null
        val fallbackVoice = fallbackLocale?.let { findVoice(voices, it, offlineOnly) }
        val chosenVoice = preferredVoice ?: fallbackVoice

        if (offlineOnly && chosenVoice == null) {
            return VoiceSelection(
                languageTag = requested.toLanguageTag(),
                localVoice = false,
                fallbackUsed = false,
                message = "No installed offline " + requested.toLanguageTag() +
                    " speech voice is available. Download an offline voice in Android text-to-speech settings. JARVIS did not use a network voice.",
                available = false
            )
        }

        engine.setSpeechRate(1.0f)
        engine.setPitch(1.0f)

        if (chosenVoice != null) {
            val result = engine.setVoice(chosenVoice)
            if (result == TextToSpeech.SUCCESS) {
                engine.language = chosenVoice.locale
                val fallbackUsed = chosenVoice.locale.language != requested.language
                val local = !chosenVoice.isNetworkConnectionRequired
                val message = when {
                    fallbackUsed && local -> "Hindi voice data is unavailable; using an installed offline English voice."
                    fallbackUsed -> "Hindi voice data is unavailable; using the configured system English voice."
                    local -> "Using an installed offline " + chosenVoice.locale.toLanguageTag() + " voice."
                    else -> "Using the configured system " + chosenVoice.locale.toLanguageTag() + " voice; the speech engine may require a network connection."
                }
                return VoiceSelection(
                    languageTag = chosenVoice.locale.toLanguageTag(),
                    localVoice = local,
                    fallbackUsed = fallbackUsed,
                    message = message
                )
            }
        }

        if (offlineOnly) {
            return VoiceSelection(
                languageTag = requested.toLanguageTag(),
                localVoice = false,
                fallbackUsed = false,
                message = "The installed offline voice could not be activated. JARVIS did not try a network voice. Check Android text-to-speech settings and install local Hindi or English voice data.",
                available = false
            )
        }

        if (offlineOnly) {
            return VoiceSelection(
                languageTag = requested.toLanguageTag(),
                localVoice = false,
                fallbackUsed = false,
                message = "The installed offline voice could not be activated. JARVIS did not try a network voice. Check Android text-to-speech settings and install local Hindi or English voice data.",
                available = false
            )
        }

        val fallbackStatus = if (fallbackLocale != null) {
            engine.setLanguage(fallbackLocale)
        } else {
            engine.setLanguage(requested)
        }
        val selectedLocale = if (fallbackStatus >= TextToSpeech.LANG_AVAILABLE && fallbackLocale != null) {
            fallbackLocale
        } else {
            requested
        }
        val supported = engine.isLanguageAvailable(selectedLocale) >= TextToSpeech.LANG_AVAILABLE
        return VoiceSelection(
            languageTag = selectedLocale.toLanguageTag(),
            localVoice = false,
            fallbackUsed = selectedLocale.language != requested.language,
            message = if (supported) {
                "Using the Android system " + selectedLocale.toLanguageTag() + " voice."
            } else {
                "No supported " + requested.toLanguageTag() + " voice is installed. Install Hindi or English voice data in Android settings."
            }
        )
    }

    fun split(text: String, maxChars: Int = 900): List<String> {
        val normalized = text.trim().replace(Regex("\\s+"), " ")
        if (normalized.isEmpty()) return emptyList()
        val limit = maxChars.coerceIn(120, 3000)
        val chunks = mutableListOf<String>()
        var remaining = normalized

        while (remaining.length > limit) {
            val punctuation = listOf('.', '!', '?', '।', '。')
                .map { remaining.lastIndexOf(it, limit - 1) }
                .maxOrNull() ?: -1
            val word = remaining.lastIndexOf(' ', limit - 1)
            val boundary = if (punctuation >= (limit * 0.45).toInt()) {
                punctuation + 1
            } else if (word > 0) {
                word
            } else {
                limit
            }
            val chunk = remaining.substring(0, boundary).trim()
            if (chunk.isNotEmpty()) chunks += chunk
            remaining = remaining.substring(boundary).trim()
        }
        if (remaining.isNotEmpty()) chunks += remaining
        return chunks
    }

    fun speakChunks(engine: TextToSpeech, text: String, utterancePrefix: String): List<String> {
        val chunks = split(text)
        chunks.forEachIndexed { index, chunk ->
            val queueMode = if (index == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
            val result = engine.speak(chunk, queueMode, null, utterancePrefix + "-" + index)
            if (result == TextToSpeech.ERROR) {
                engine.stop()
                throw IllegalStateException("Android text-to-speech could not queue a reply chunk.")
            }
        }
        return chunks
    }

    private fun findVoice(voices: Set<Voice>, requested: Locale, offlineOnly: Boolean): Voice? {
        val sameLanguage = voices.filter { it.locale.language.equals(requested.language, ignoreCase = true) }
        val exactLocale = sameLanguage.filter {
            it.locale.country.equals(requested.country, ignoreCase = true)
        }
        val localExact = exactLocale.firstOrNull { !it.isNetworkConnectionRequired }
        val localLanguage = sameLanguage.firstOrNull { !it.isNetworkConnectionRequired }
        if (offlineOnly) return localExact ?: localLanguage
        return localExact
            ?: localLanguage
            ?: exactLocale.firstOrNull()
            ?: sameLanguage.firstOrNull()
    }
}
