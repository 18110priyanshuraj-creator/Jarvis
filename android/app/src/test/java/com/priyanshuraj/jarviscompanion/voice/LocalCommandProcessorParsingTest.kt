package com.priyanshuraj.jarviscompanion.voice

import org.junit.Assert.assertEquals
import org.junit.Test

class LocalCommandProcessorParsingTest {
    @Test
    fun stripsWakeWordBeforeMatchingLocalCommands() {
        assertEquals("open Canva", LocalCommandProcessor.normalizeCommand("Jarvis, open Canva"))
        assertEquals("open Chrome", LocalCommandProcessor.normalizeCommand("  JARVIS: open Chrome  "))
        assertEquals("open Canva", LocalCommandProcessor.normalizeCommand("open Canva"))
    }

    @Test
    fun onlyStripsWakeWordAtTheBeginning() {
        assertEquals("please ask Jarvis to open Canva", LocalCommandProcessor.normalizeCommand("please ask Jarvis to open Canva"))
    }
}
