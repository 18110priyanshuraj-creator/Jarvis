package com.priyanshuraj.jarviscompanion.accessibility

import java.util.Locale

internal enum class CanvaEditorCommandType {
    TOGGLE_FORMAT,
    SET_FONT_SIZE,
    OPEN_REPLACE
}

internal data class CanvaEditorCommand(
    val type: CanvaEditorCommandType,
    val label: String,
    val value: String = ""
)

/**
 * Maps a small, explicit set of Canva editing requests to visible toolbar labels.
 *
 * This deliberately does not automate sign-in, uploads, publishing, arbitrary canvas
 * coordinates, or timeline trimming. The user selects the element in Canva first.
 */
internal object CanvaAccessibilityPolicy {
    private val formatLabels = mapOf(
        "bold" to "Bold",
        "italic" to "Italics",
        "italics" to "Italics",
        "underline" to "Underline",
        "strikethrough" to "Strikethrough",
        "strike through" to "Strikethrough",
        "uppercase" to "Uppercase"
    )

    private val fontSizePatterns = listOf(
        Regex("""^(?:set|change) (?:the )?font size (?:to )?(\d{1,3})$"""),
        Regex("""^font size (\d{1,3})$"""),
        Regex("""^selected text ka size (\d{1,3}) karo$""")
    )

    private val replacePatterns = listOf(
        Regex("""^(?:replace|change) (?:the )?selected (?:image|photo|video|media)(?: file| asset)?$"""),
        Regex("""^selected (?:image|photo|video|media) replace karo$""")
    )

    private val formatPatterns = listOf(
        Regex("""^(?:toggle )?(bold|italic|italics|underline|strikethrough|strike through|uppercase) selected text$"""),
        Regex("""^(?:make|set) selected text (?:appear )?(bold|italic|italics|underline|strikethrough|uppercase)$"""),
        Regex("""^selected text ko (bold|italic|italics|underline|strikethrough|uppercase) (?:toggle|karo|kar do)$"""),
        Regex("""^toggle selected text (bold|italic|italics|underline|strikethrough|uppercase)$""")
    )

    fun parse(message: String): CanvaEditorCommand? {
        val input = normalize(message)
        if (input.isBlank()) return null

        for (pattern in formatPatterns) {
            val style = pattern.matchEntire(input)?.groupValues?.getOrNull(1)
            if (!style.isNullOrBlank()) {
                val label = formatLabels[style] ?: return null
                return CanvaEditorCommand(CanvaEditorCommandType.TOGGLE_FORMAT, label)
            }
        }

        for (pattern in fontSizePatterns) {
            val rawSize = pattern.matchEntire(input)?.groupValues?.getOrNull(1) ?: continue
            val size = rawSize.toIntOrNull() ?: return null
            if (size !in 6..200) return null
            return CanvaEditorCommand(CanvaEditorCommandType.SET_FONT_SIZE, "Font size", size.toString())
        }

        if (replacePatterns.any { it.matches(input) }) {
            return CanvaEditorCommand(CanvaEditorCommandType.OPEN_REPLACE, "Replace")
        }
        return null
    }

    fun isCanvaPackage(packageName: String?): Boolean {
        val value = packageName?.trim()?.lowercase(Locale.ROOT).orEmpty()
        return value.isNotBlank() && value.contains("canva")
    }

    private fun normalize(value: String): String =
        value.trim()
            .lowercase(Locale.ROOT)
            .replace('’', '\'')
            .replace(Regex("""^(?:(?:hey|okay|ok|hello|hi)\s+)?jarvis[\s,:;-]+"""), "")
            .replace(Regex("""\s+"""), " ")
            .trim()
            .trimEnd('.', '!', '?', '।', '॥')
}
