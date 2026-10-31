package com.priyanshuraj.jarviscompanion.accessibility

import android.view.accessibility.AccessibilityNodeInfo

/**
 * Reads a bounded summary only after an explicit user request.
 * The returned text is never written to preferences, logs, or the JARVIS server.
 */
object ScreenObserver {
    private const val MAX_NODES = 150
    private const val MAX_LINES = 24
    private const val MAX_LENGTH = 1400
    private val longNumber = Regex("""(?<!\d)\d{4,10}(?!\d)""")

    fun describe(root: AccessibilityNodeInfo?): String {
        if (root == null) {
            return "I cannot access the current screen. Check that JARVIS screen access is enabled."
        }

        val lines = linkedSetOf<String>()
        var visited = 0

        fun visit(node: AccessibilityNodeInfo, depth: Int) {
            if (visited >= MAX_NODES || depth > 18 || !node.isVisibleToUser) return
            visited++

            val line = when {
                node.isPassword -> "Protected input field"
                node.isEditable -> {
                    val hint = node.hintText?.toString()?.trim().orEmpty()
                    if (hint.isBlank()) "Text input field" else "Text input: " + hint
                }
                else -> {
                    val text = node.text?.toString()?.trim().orEmpty()
                    val description = node.contentDescription?.toString()?.trim().orEmpty()
                    (if (text.isNotBlank()) text else description).take(180)
                        .replace(longNumber, "••••")
                }
            }

            if (line.isNotBlank()) lines.add(line)
            if (lines.size < MAX_LINES) {
                for (index in 0 until node.childCount) {
                    val child = node.getChild(index) ?: continue
                    visit(child, depth + 1)
                    if (lines.size >= MAX_LINES || visited >= MAX_NODES) break
                }
            }
        }

        visit(root, 0)
        if (lines.isEmpty()) {
            return "This app does not expose readable screen labels to Android accessibility."
        }

        val summary = lines.joinToString(separator = "\n") { "• " + it }
        return if (summary.length > MAX_LENGTH) {
            summary.take(MAX_LENGTH).trimEnd() + "…"
        } else {
            summary
        }
    }
}
