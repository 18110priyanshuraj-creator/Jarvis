package com.priyanshuraj.jarviscompanion.accessibility

import android.graphics.Rect
import android.os.Bundle
import android.text.InputType
import android.view.accessibility.AccessibilityNodeInfo

data class UiActionResult(val ok: Boolean, val message: String)

object UIActionExecutor {
    private val protectedAction = Regex(
        """\b(send|submit|delete|remove|pay|payment|purchase|buy|transfer|confirm|otp|one.?time|password|passcode|pin|verification|checkout|order|uninstall|grant|allow|deny|revoke)\b""",
        RegexOption.IGNORE_CASE
    )
    private val sensitiveScreen = Regex(
        """\b(password|passcode|pin|otp|one.?time code|verification code|security code|recovery code)\b""",
        RegexOption.IGNORE_CASE
    )
    private val numericSecret = Regex("""^\d{4,10}$""")

    fun clickExactLabel(service: JarvisAccessibilityService, requestedLabel: String): UiActionResult {
        val label = requestedLabel.trim().trim('"', '\'')
        if (label.isBlank()) return UiActionResult(false, "Tell me the exact visible button or item label.")
        if (protectedAction.containsMatchIn(label)) {
            return UiActionResult(false, "I will not activate a send, delete, payment, confirmation or security control. Please do that manually.")
        }

        val root = service.rootInActiveWindow
            ?: return UiActionResult(false, "The current app did not expose an accessible screen.")
        val nodes = collectNodes(root)
        val candidates = linkedMapOf<String, AccessibilityNodeInfo>()

        for (node in nodes) {
            if (!node.isVisibleToUser || node.isPassword || !matchesLabel(node, label)) continue
            val clickable = nearestClickable(node) ?: continue
            if (isProtectedContext(clickable)) continue

            val rect = Rect()
            clickable.getBoundsInScreen(rect)
            val key = listOf(
                rect.left, rect.top, rect.right, rect.bottom,
                clickable.className?.toString().orEmpty(),
                clickable.viewIdResourceName.orEmpty()
            ).joinToString(":")
            candidates.putIfAbsent(key, clickable)
        }

        return when (candidates.size) {
            0 -> UiActionResult(false, "I could not find a safe, clickable item with the exact label: " + label + ".")
            1 -> {
                val clicked = candidates.values.first().performAction(AccessibilityNodeInfo.ACTION_CLICK)
                if (clicked) UiActionResult(true, "Tapped " + label + ".")
                else UiActionResult(false, "Android did not accept that tap. Try selecting the item manually.")
            }
            else -> UiActionResult(false, "I found more than one item named " + label + ". Please use a more specific visible label.")
        }
    }

    fun typeIntoFocusedField(service: JarvisAccessibilityService, text: String): UiActionResult {
        val value = text.trim()
        if (value.isBlank()) return UiActionResult(false, "Tell me the text to enter.")
        if (value.length > 300) return UiActionResult(false, "For safety, a single voice entry is limited to 300 characters.")
        if (numericSecret.matches(value)) {
            return UiActionResult(false, "I will not enter a number that could be a PIN or one-time code.")
        }

        val root = service.rootInActiveWindow
            ?: return UiActionResult(false, "The current app did not expose an accessible screen.")
        if (sensitiveScreen.containsMatchIn(visibleText(root))) {
            return UiActionResult(false, "This screen may contain a password, PIN or verification code. Enter sensitive information manually.")
        }

        val focused = service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: return UiActionResult(false, "Tap the text field yourself first, then ask me to type.")
        if (!focused.isEditable || focused.isPassword || isPasswordInput(focused.inputType)) {
            return UiActionResult(false, "I cannot type into password or protected fields.")
        }

        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
        }
        val updated = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
        return if (updated) {
            UiActionResult(true, "Entered the text. I have not pressed Send or Submit.")
        } else {
            UiActionResult(false, "The focused field did not accept text. Please check the field and try again.")
        }
    }

    fun scroll(service: JarvisAccessibilityService, forward: Boolean): UiActionResult {
        val root = service.rootInActiveWindow
            ?: return UiActionResult(false, "The current app did not expose an accessible screen.")
        val nodes = collectNodes(root).asReversed()
        val action = if (forward) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        for (node in nodes) {
            if (node.isVisibleToUser && node.isScrollable && node.performAction(action)) {
                return UiActionResult(true, if (forward) "Scrolled down." else "Scrolled up.")
            }
        }
        return UiActionResult(false, "I could not find a scrollable area on this screen.")
    }

    fun goBack(service: JarvisAccessibilityService): UiActionResult {
        val ok = service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
        return UiActionResult(ok, if (ok) "Went back." else "Android could not go back from this screen.")
    }

    fun goHome(service: JarvisAccessibilityService): UiActionResult {
        val ok = service.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME)
        return UiActionResult(ok, if (ok) "Returned to the home screen." else "Android could not open the home screen.")
    }

    private fun collectNodes(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
        val result = mutableListOf<AccessibilityNodeInfo>()
        fun visit(node: AccessibilityNodeInfo, depth: Int) {
            if (depth > 18 || result.size >= 180) return
            result.add(node)
            for (index in 0 until node.childCount) {
                val child = node.getChild(index) ?: continue
                visit(child, depth + 1)
                if (result.size >= 180) break
            }
        }
        visit(root, 0)
        return result
    }

    private fun matchesLabel(node: AccessibilityNodeInfo, label: String): Boolean {
        val text = node.text?.toString()?.trim()
        val description = node.contentDescription?.toString()?.trim()
        return text.equals(label, ignoreCase = true) || description.equals(label, ignoreCase = true)
    }

    private fun nearestClickable(start: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = start
        var depth = 0
        while (current != null && depth <= 5) {
            if (current.isClickable) return current
            current = current.parent
            depth++
        }
        return null
    }

    private fun isProtectedContext(start: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = start
        var depth = 0
        while (current != null && depth <= 5) {
            if (current.isPassword) return true
            val label = listOf(
                current.text?.toString().orEmpty(),
                current.contentDescription?.toString().orEmpty()
            ).joinToString(" ")
            if (protectedAction.containsMatchIn(label)) return true
            current = current.parent
            depth++
        }
        return false
    }

    private fun visibleText(root: AccessibilityNodeInfo): String {
        val text = StringBuilder()
        fun visit(node: AccessibilityNodeInfo, depth: Int) {
            if (depth > 16 || text.length > 6000) return
            if (node.isVisibleToUser && !node.isPassword) {
                text.append(node.text?.toString().orEmpty()).append(' ')
                text.append(node.contentDescription?.toString().orEmpty()).append(' ')
            }
            for (index in 0 until node.childCount) {
                val child = node.getChild(index) ?: continue
                visit(child, depth + 1)
                if (text.length > 6000) break
            }
        }
        visit(root, 0)
        return text.toString()
    }

    private fun isPasswordInput(inputType: Int): Boolean {
        val inputClass = inputType and InputType.TYPE_MASK_CLASS
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return when (inputClass) {
            InputType.TYPE_CLASS_TEXT -> variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }
}
