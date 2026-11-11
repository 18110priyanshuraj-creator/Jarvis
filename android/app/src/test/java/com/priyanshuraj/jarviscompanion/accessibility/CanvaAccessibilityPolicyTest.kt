package com.priyanshuraj.jarviscompanion.accessibility

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CanvaAccessibilityPolicyTest {
    @Test
    fun parsesFormattingCommandsIntoExactToolbarLabels() {
        assertEquals(
            CanvaEditorCommand(CanvaEditorCommandType.TOGGLE_FORMAT, "Bold"),
            CanvaAccessibilityPolicy.parse("Jarvis, bold selected text")
        )
        assertEquals(
            CanvaEditorCommand(CanvaEditorCommandType.TOGGLE_FORMAT, "Italics"),
            CanvaAccessibilityPolicy.parse("toggle selected text italic")
        )
        assertEquals(
            CanvaEditorCommand(CanvaEditorCommandType.TOGGLE_FORMAT, "Underline"),
            CanvaAccessibilityPolicy.parse("selected text ko underline karo")
        )
        assertEquals(
            CanvaEditorCommand(CanvaEditorCommandType.TOGGLE_FORMAT, "Strikethrough"),
            CanvaAccessibilityPolicy.parse("toggle strikethrough selected text")
        )
        assertEquals(
            CanvaEditorCommand(CanvaEditorCommandType.TOGGLE_FORMAT, "Uppercase"),
            CanvaAccessibilityPolicy.parse("make selected text uppercase")
        )
    }

    @Test
    fun parsesBoundedFontSizeAndRejectsOutOfRangeValues() {
        assertEquals(
            CanvaEditorCommand(CanvaEditorCommandType.SET_FONT_SIZE, "Font size", "32"),
            CanvaAccessibilityPolicy.parse("set font size to 32")
        )
        assertEquals(
            CanvaEditorCommand(CanvaEditorCommandType.SET_FONT_SIZE, "Font size", "18"),
            CanvaAccessibilityPolicy.parse("selected text ka size 18 karo")
        )
        assertNull(CanvaAccessibilityPolicy.parse("set font size to 0"))
        assertNull(CanvaAccessibilityPolicy.parse("set font size to 201"))
    }

    @Test
    fun parsesOnlySelectedMediaReplacementAndNoAutonomousUploadCommand() {
        assertEquals(
            CanvaEditorCommand(CanvaEditorCommandType.OPEN_REPLACE, "Replace"),
            CanvaAccessibilityPolicy.parse("replace selected image")
        )
        assertEquals(
            CanvaEditorCommand(CanvaEditorCommandType.OPEN_REPLACE, "Replace"),
            CanvaAccessibilityPolicy.parse("selected video replace karo")
        )
        assertNull(CanvaAccessibilityPolicy.parse("upload this video and publish it"))
        assertNull(CanvaAccessibilityPolicy.parse("replace the whole design automatically"))
    }

    @Test
    fun commandsAreScopedToCanvaForegroundPackage() {
        assertTrue(CanvaAccessibilityPolicy.isCanvaPackage("com.canva.editor"))
        assertTrue(CanvaAccessibilityPolicy.isCanvaPackage("com.example.canva"))
        assertFalse(CanvaAccessibilityPolicy.isCanvaPackage("com.android.chrome"))
        assertFalse(CanvaAccessibilityPolicy.isCanvaPackage(null))
    }
}
