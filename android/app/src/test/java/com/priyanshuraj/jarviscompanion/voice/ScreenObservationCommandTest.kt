package com.priyanshuraj.jarviscompanion.voice

import com.priyanshuraj.jarviscompanion.voice.LocalCommandProcessor
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenObservationCommandTest {
    @Test
    fun recognizesExplicitScreenObservationPhrasesInEnglishAndHindi() {
        listOf(
            "read screen",
            "describe my screen",
            "what is on screen",
            "what does this page say",
            "read visible text",
            "screen pe kya likha hai",
            "screen par kya hai",
            "kya dikh raha hai",
            "screen ko padh kar batao"
        ).forEach { assertTrue(it, LocalCommandProcessor.isScreenObservationCommand(it)) }
    }

    @Test
    fun doesNotTreatOrdinaryChatAsScreenObservation() {
        listOf(
            "tell me about physics",
            "open YouTube",
            "what is machine learning",
            "read my notes later"
        ).forEach { assertFalse(it, LocalCommandProcessor.isScreenObservationCommand(it)) }
    }
}
