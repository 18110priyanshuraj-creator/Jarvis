package com.priyanshuraj.jarviscompanion.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WakeWordPolicyTest {
    @Test
    fun acceptsEnglishWakePhraseVariants() {
        assertEquals("open YouTube", WakeWordPolicy.commandAfterWakeWord("Hey Jarvis, open YouTube"))
        assertEquals("search latest AI research", WakeWordPolicy.commandAfterWakeWord("Okay JARVIS search latest AI research"))
        assertEquals("go back", WakeWordPolicy.commandAfterWakeWord("Jarvis: go back"))
        assertEquals("open Canva", WakeWordPolicy.commandAfterWakeWord("Hello Jarvis — open Canva"))
    }

    @Test
    fun acceptsHindiAndHinglishCommandsAfterWakePhrase() {
        assertEquals("YouTube kholo", WakeWordPolicy.commandAfterWakeWord("Hey Jarvis, YouTube kholo"))
        assertEquals("Google par JEE Main search karo", WakeWordPolicy.commandAfterWakeWord("Jarvis Google par JEE Main search karo"))
    }

    @Test
    fun rejectsCommandsWithoutWakePhraseAndAllowsWakeOnlyPrompt() {
        assertNull(WakeWordPolicy.commandAfterWakeWord("open YouTube"))
        assertNull(WakeWordPolicy.commandAfterWakeWord("Hey there, open YouTube"))
        assertEquals("", WakeWordPolicy.commandAfterWakeWord("Jarvis"))
        assertEquals("", WakeWordPolicy.commandAfterWakeWord("Okay Jarvis"))
    }
}
