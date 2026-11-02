package com.priyanshuraj.jarviscompanion.accessibility

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UiActionPolicyTest {
    @Test
    fun exactLabelMatchingNormalizesCaseAndWhitespaceButNeverUsesPartialMatches() {
        assertTrue(UiActionPolicy.matchesExactLabel("  Wi-Fi   settings ", null, "wi-fi settings"))
        assertTrue(UiActionPolicy.matchesExactLabel(null, "Open   dashboard", "open dashboard"))
        assertFalse(UiActionPolicy.matchesExactLabel("Open dashboard settings", null, "open dashboard"))
        assertFalse(UiActionPolicy.matchesExactLabel("Dashboard", null, ""))
    }

    @Test
    fun safeVisibleEnabledClickableTargetsAreAllowed() {
        val decision = UiActionPolicy.validateTap(
            requestedLabel = "Settings",
            contextLabels = listOf("Settings", "Navigation bar"),
            visible = true,
            enabled = true,
            clickable = true
        )
        assertTrue(decision.allowed)
        assertEquals(UiActionPolicyCode.ALLOWED, decision.code)
    }

    @Test
    fun consequentialControlsAreBlockedEvenWhenNestedUnderSafeLabels() {
        listOf("Send", "Delete account", "Pay now", "Allow", "Confirm", "Uninstall").forEach { label ->
            val decision = UiActionPolicy.validateTap(label, emptyList(), true, true, true)
            assertFalse(label, decision.allowed)
            assertEquals(UiActionPolicyCode.PROTECTED_CONTROL, decision.code)
        }
        val nested = UiActionPolicy.validateTap(
            "Continue",
            listOf("Continue", "Payment confirmation"),
            true, true, true
        )
        assertFalse(nested.allowed)
        assertEquals(UiActionPolicyCode.PROTECTED_CONTROL, nested.code)
    }

    @Test
    fun credentialAndVerificationScreensBlockActionsAndTyping() {
        assertTrue(UiActionPolicy.isProtectedScreen(listOf("Enter your password")))
        assertTrue(UiActionPolicy.isProtectedScreen(listOf("One-time verification code")))
        assertTrue(UiActionPolicy.isProtectedScreen(listOf("Card number and CVV")))
        assertFalse(UiActionPolicy.isProtectedScreen(listOf("Welcome to JARVIS")))

        val decision = UiActionPolicy.validateTextTarget(
            visible = true,
            enabled = true,
            editable = true,
            password = false,
            screenLabels = listOf("Verification code")
        )
        assertFalse(decision.allowed)
        assertEquals(UiActionPolicyCode.PROTECTED_SCREEN, decision.code)
    }

    @Test
    fun textEntryRequiresAVisibleEnabledNonPasswordEditableField() {
        val safe = UiActionPolicy.validateTextTarget(true, true, true, false, listOf("Search"))
        assertTrue(safe.allowed)
        assertEquals(UiActionPolicyCode.FIELD_NOT_VISIBLE,
            UiActionPolicy.validateTextTarget(false, true, true, false, emptyList()).code)
        assertEquals(UiActionPolicyCode.FIELD_DISABLED,
            UiActionPolicy.validateTextTarget(true, false, true, false, emptyList()).code)
        assertEquals(UiActionPolicyCode.FIELD_NOT_EDITABLE,
            UiActionPolicy.validateTextTarget(true, true, false, false, emptyList()).code)
        assertEquals(UiActionPolicyCode.PASSWORD_FIELD,
            UiActionPolicy.validateTextTarget(true, true, true, true, emptyList()).code)
    }

    @Test
    fun textPayloadHasExplicitBoundsAndRejectsLikelySecrets() {
        assertTrue(UiActionPolicy.validateTextPayload("JEE Physics", 160).allowed)
        assertEquals(UiActionPolicyCode.EMPTY_TEXT,
            UiActionPolicy.validateTextPayload("  ").code)
        assertEquals(UiActionPolicyCode.TEXT_TOO_LONG,
            UiActionPolicy.validateTextPayload("x".repeat(161), 160).code)
        assertEquals(UiActionPolicyCode.SENSITIVE_TEXT,
            UiActionPolicy.validateTextPayload("123456").code)
        assertEquals(UiActionPolicyCode.SENSITIVE_TEXT,
            UiActionPolicy.validateTextPayload("my password is secret").code)
    }

    @Test
    fun scrollingRequiresAnEnabledVisibleScrollableTarget() {
        assertTrue(UiActionPolicy.validateScrollTarget(true, true, true).allowed)
        assertEquals(UiActionPolicyCode.TARGET_NOT_VISIBLE,
            UiActionPolicy.validateScrollTarget(false, true, true).code)
        assertEquals(UiActionPolicyCode.TARGET_DISABLED,
            UiActionPolicy.validateScrollTarget(true, false, true).code)
        assertEquals(UiActionPolicyCode.TARGET_NOT_CLICKABLE,
            UiActionPolicy.validateScrollTarget(true, true, false).code)
    }
}
