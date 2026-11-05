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

    @Test
    fun recognizesNaturalEnglishAndHindiAppLaunchPhrases() {
        assertEquals("Canva", LocalCommandProcessor.appLaunchTarget("Jarvis, open Canva"))
        assertEquals("Canva", LocalCommandProcessor.appLaunchTarget("Canva kholo"))
        assertEquals("Canva", LocalCommandProcessor.appLaunchTarget("mujhe Canva khol do"))
        assertEquals("Canva", LocalCommandProcessor.appLaunchTarget("Canva open karo"))
        assertEquals("Chrome", LocalCommandProcessor.appLaunchTarget("please launch Chrome"))
    }
}
