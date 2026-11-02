package com.priyanshuraj.jarviscompanion.voice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceRecognitionPolicyTest {
    @Test
    fun preferOfflineSelectsOnDeviceRecognizerWhenAvailable() {
        val decision = VoiceRecognitionPolicy.evaluate(
            VoicePrivacyMode.PREFER_OFFLINE,
            sdkInt = 35,
            recognitionServiceAvailable = true,
            onDeviceRecognitionAvailable = true
        )
        assertTrue(decision.canStart)
        assertTrue(decision.useOnDeviceRecognizer)
        assertFalse(decision.preferOfflineHint)
        assertTrue(decision.status.contains("On-device"))
    }

    @Test
    fun offlineOnlyNeverFallsBackToSystemRecognizer() {
        val decision = VoiceRecognitionPolicy.evaluate(
            VoicePrivacyMode.OFFLINE_ONLY,
            sdkInt = 35,
            recognitionServiceAvailable = true,
            onDeviceRecognitionAvailable = false
        )
        assertFalse(decision.canStart)
        assertFalse(decision.useOnDeviceRecognizer)
        assertFalse(decision.preferOfflineHint)
        assertTrue(decision.status.contains("No online recognizer was started"))
    }

    @Test
    fun offlineOnlyRequiresAndroidVersionWithOnDeviceRecognizerSupport() {
        val decision = VoiceRecognitionPolicy.evaluate(
            VoicePrivacyMode.OFFLINE_ONLY,
            sdkInt = 30,
            recognitionServiceAvailable = true,
            onDeviceRecognitionAvailable = true
        )
        assertFalse(decision.canStart)
        assertTrue(decision.status.contains("Offline speech recognition is unavailable"))
    }

    @Test
    fun preferOfflineExplainsWhenSystemProviderMayUseNetwork() {
        val decision = VoiceRecognitionPolicy.evaluate(
            VoicePrivacyMode.PREFER_OFFLINE,
            sdkInt = 30,
            recognitionServiceAvailable = true,
            onDeviceRecognitionAvailable = false
        )
        assertTrue(decision.canStart)
        assertFalse(decision.useOnDeviceRecognizer)
        assertTrue(decision.preferOfflineHint)
        assertTrue(decision.status.contains("may require internet"))
    }

    @Test
    fun unavailableRecognitionServiceBlocksBothModes() {
        for (mode in VoicePrivacyMode.values()) {
            val decision = VoiceRecognitionPolicy.evaluate(
                mode,
                sdkInt = 35,
                recognitionServiceAvailable = false,
                onDeviceRecognitionAvailable = true
            )
            assertFalse(decision.canStart)
        }
    }

    @Test
    fun unknownStoredModesDefaultToPreferOffline() {
        assertEquals(VoicePrivacyMode.PREFER_OFFLINE, VoicePrivacyMode.fromStorage(null))
        assertEquals(VoicePrivacyMode.PREFER_OFFLINE, VoicePrivacyMode.fromStorage("not-a-mode"))
        assertEquals(VoicePrivacyMode.OFFLINE_ONLY, VoicePrivacyMode.fromStorage("offline_only"))
    }
}
