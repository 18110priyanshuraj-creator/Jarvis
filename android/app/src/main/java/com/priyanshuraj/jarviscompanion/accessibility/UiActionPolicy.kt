package com.priyanshuraj.jarviscompanion.accessibility

import java.util.Locale

enum class UiActionPolicyCode {
    ALLOWED,
    EMPTY_TARGET,
    PROTECTED_CONTROL,
    PROTECTED_SCREEN,
    TARGET_NOT_VISIBLE,
    TARGET_DISABLED,
    TARGET_NOT_CLICKABLE,
    EMPTY_TEXT,
    TEXT_TOO_LONG,
    SENSITIVE_TEXT,
    FIELD_NOT_VISIBLE,
    FIELD_DISABLED,
    FIELD_NOT_EDITABLE,
    PASSWORD_FIELD
}

data class UiActionPolicyDecision(
    val allowed: Boolean,
    val code: UiActionPolicyCode,
    val explanation: String
)

/**
 * One conservative policy for manual commands and AI-proposed Android actions.
 * This policy never grants permission for arbitrary gestures or consequential controls.
 */
object UiActionPolicy {
    private val protectedControl = Regex(
        """(?i)\b(send|submit|delete|remove|pay|payment|purchase|buy|transfer|confirm|otp|one.?time|password|passcode|pin|verification|checkout|order|uninstall|grant|allow|deny|revoke|permission|sign.?out|log.?out|cvv|cvc|card number|credit card|bank account)\b"""
    )
    private val protectedScreen = Regex(
        """(?i)\b(password|passcode|pin|otp|one[- ]time(?:[- ](?:password|code))?|verification(?: code)?|security code|recovery code|cvv|cvc|card number|bank account)\b"""
    )
    private val sensitiveText = Regex(
        """(?i)\b(password|passcode|otp|one[- ]time(?:[- ]code)?|pin|cvv|cvc|security code|bank account|card number|payment|transfer|delete|submit|send)\b"""
    )
    private val numericSecret = Regex("""^\d{4,10}$""")
    private val whitespace = Regex("""\s+""")

    fun normalizeLabel(value: String): String =
        whitespace.replace(value.lowercase(Locale.ROOT), " ").trim()

    fun matchesExactLabel(nodeText: String?, nodeDescription: String?, requested: String): Boolean {
        val expected = normalizeLabel(requested)
        if (expected.isBlank()) return false
        return normalizeLabel(nodeText.orEmpty()) == expected ||
            normalizeLabel(nodeDescription.orEmpty()) == expected
    }

    fun isProtectedControl(label: String): Boolean =
        protectedControl.containsMatchIn(label)

    fun isProtectedScreen(labels: Iterable<String>): Boolean =
        labels.any { protectedScreen.containsMatchIn(it) }

    fun validateTap(
        requestedLabel: String,
        contextLabels: Iterable<String>,
        visible: Boolean,
        enabled: Boolean,
        clickable: Boolean
    ): UiActionPolicyDecision {
        if (normalizeLabel(requestedLabel).isBlank()) {
            return blocked(UiActionPolicyCode.EMPTY_TARGET, "A visible exact label is required.")
        }
        if (isProtectedControl(requestedLabel) ||
            contextLabels.any { isProtectedControl(it) }
        ) {
            return blocked(
                UiActionPolicyCode.PROTECTED_CONTROL,
                "This control or its parent appears consequential or security-sensitive. Complete it manually."
            )
        }
        if (isProtectedScreen(contextLabels)) {
            return blocked(
                UiActionPolicyCode.PROTECTED_SCREEN,
                "This screen may contain credentials or verification details. Complete it manually."
            )
        }
        if (!visible) {
            return blocked(UiActionPolicyCode.TARGET_NOT_VISIBLE, "The target is not visible.")
        }
        if (!enabled) {
            return blocked(UiActionPolicyCode.TARGET_DISABLED, "Android reports that the target is disabled.")
        }
        if (!clickable) {
            return blocked(UiActionPolicyCode.TARGET_NOT_CLICKABLE, "The target is not clickable.")
        }
        return allowed()
    }

    fun validateTextPayload(text: String, maxLength: Int = 300): UiActionPolicyDecision {
        val value = text.trim()
        if (value.isBlank()) return blocked(UiActionPolicyCode.EMPTY_TEXT, "Text entry cannot be empty.")
        if (value.length > maxLength) {
            return blocked(UiActionPolicyCode.TEXT_TOO_LONG, "Text entry exceeds the $maxLength character limit.")
        }
        if (numericSecret.matches(value) || sensitiveText.containsMatchIn(value)) {
            return blocked(
                UiActionPolicyCode.SENSITIVE_TEXT,
                "This text may contain a secret or request a consequential action. Enter sensitive information manually."
            )
        }
        return allowed()
    }

    fun validateTextTarget(
        visible: Boolean,
        enabled: Boolean,
        editable: Boolean,
        password: Boolean,
        screenLabels: Iterable<String>
    ): UiActionPolicyDecision {
        if (isProtectedScreen(screenLabels)) {
            return blocked(
                UiActionPolicyCode.PROTECTED_SCREEN,
                "This screen may contain credentials or verification details. Enter information manually."
            )
        }
        if (!visible) return blocked(UiActionPolicyCode.FIELD_NOT_VISIBLE, "The focused field is not visible.")
        if (!enabled) return blocked(UiActionPolicyCode.FIELD_DISABLED, "The focused field is disabled.")
        if (password) return blocked(UiActionPolicyCode.PASSWORD_FIELD, "Password and protected fields cannot be filled by JARVIS.")
        if (!editable) return blocked(UiActionPolicyCode.FIELD_NOT_EDITABLE, "The focused item is not an editable text field.")
        return allowed()
    }

    fun validateScrollTarget(visible: Boolean, enabled: Boolean, scrollable: Boolean): UiActionPolicyDecision {
        if (!visible) return blocked(UiActionPolicyCode.TARGET_NOT_VISIBLE, "The scroll area is not visible.")
        if (!enabled) return blocked(UiActionPolicyCode.TARGET_DISABLED, "The scroll area is disabled.")
        if (!scrollable) return blocked(UiActionPolicyCode.TARGET_NOT_CLICKABLE, "The target is not a scrollable area.")
        return allowed()
    }

    private fun allowed() = UiActionPolicyDecision(true, UiActionPolicyCode.ALLOWED, "Allowed.")
    private fun blocked(code: UiActionPolicyCode, explanation: String) =
        UiActionPolicyDecision(false, code, explanation)
}
