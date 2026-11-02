package com.priyanshuraj.jarviscompanion.accessibility

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenObservationTextTest {
    @Test
    fun redactsLikelySecretsContactDetailsAndLongNumbers() {
        val output = ScreenObservationText.format(
            accessibilityText = "",
            visualLines = listOf(
                "OTP: 845120",
                "Call +91 98765 43210",
                "Email help@example.com",
                "Reference 12345678"
            )
        )

        assertTrue(output.contains("OTP: [hidden]"))
        assertTrue(output.contains("[number hidden]"))
        assertTrue(output.contains("[email hidden]"))
        assertFalse(output.contains("845120"))
        assertFalse(output.contains("98765"))
        assertFalse(output.contains("help@example.com"))
        assertFalse(output.contains("12345678"))
    }

    @Test
    fun combinesAccessibilityAndOcrWithoutRepeatingTheSameLabel() {
        val output = ScreenObservationText.format(
            accessibilityText = "• Home\n• Settings",
            visualLines = listOf("Home", "Settings", "Open dashboard")
        )

        assertTrue(output.contains("Visible text (one-time on-device OCR):"))
        assertTrue(output.contains("Accessible labels:"))
        assertTrue(output.contains("Open dashboard"))
        assertEqualsOne(output, "Home")
        assertEqualsOne(output, "Settings")
    }

    @Test
    fun boundsVeryLongScreenResults() {
        val lines = (1..80).map { index -> "Visible item " + index + " " + "x".repeat(100) }
        val output = ScreenObservationText.format("", lines)

        assertTrue(output.length <= 1800)
        assertTrue(output.endsWith("…"))
    }

    private fun assertEqualsOne(output: String, value: String) {
        assertTrue(output.contains(value))
        assertTrue(output.indexOf(value) == output.lastIndexOf(value))
    }
}
