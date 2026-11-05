package com.priyanshuraj.jarviscompanion.voice

import org.junit.Assert.assertEquals
import org.junit.Test

class LocalCommandProcessorParsingTest {
    @Test
    fun stripsWakeWordBeforeMatchingLocalCommands() {
        assertEquals("open Canva", LocalCommandProcessor.normalizeCommand("Jarvis, open Canva"))
        assertEquals("open Canva", LocalCommandProcessor.normalizeCommand("Hey Jarvis, open Canva"))
        assertEquals("open Canva", LocalCommandProcessor.normalizeCommand("Okay JARVIS open Canva"))
        assertEquals("open Chrome", LocalCommandProcessor.normalizeCommand("  JARVIS: open Chrome  "))
        assertEquals("open Canva", LocalCommandProcessor.normalizeCommand("open Canva"))
    }


    @Test
    fun recognizesPublicWebsiteLaunchTargetsAndRejectsPrivateDestinations() {
        val website = LocalCommandProcessor.appLaunchTarget(
            "Hey Jarvis, open https://www.canva.com/design/demo"
        )
        assertEquals("https://www.canva.com/design/demo", website)
        assertEquals(
            "https://www.canva.com/design/demo",
            BrowserUrlPolicy.normalize(website!!)
        )

        val bareDomain = LocalCommandProcessor.appLaunchTarget("open example.com")
        assertEquals("https://example.com/", BrowserUrlPolicy.normalize(bareDomain!!))

        val localAddress = LocalCommandProcessor.appLaunchTarget("open http://192.168.1.1")
        assertEquals(null, BrowserUrlPolicy.normalize(localAddress!!))
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
        assertEquals("Canva", LocalCommandProcessor.appLaunchTarget("Can you open Canva for me?"))
        assertEquals("Canva", LocalCommandProcessor.appLaunchTarget("open Canva to edit a video"))
        assertEquals("Google Photos", LocalCommandProcessor.appLaunchTarget("open Google Photos"))
    }
}
