package com.priyanshuraj.jarviscompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SystemControlCommandParserTest {
    @Test fun recognizesDeviceStatusAndCapabilityHelp() {
        assertEquals(LocalSystemCommand.DeviceStatus, SystemControlCommandParser.parse("device status"))
        assertEquals(LocalSystemCommand.DeviceStatus, SystemControlCommandParser.parse("बैटरी कितनी है"))
        assertEquals(LocalSystemCommand.Help, SystemControlCommandParser.parse("what can you control"))
    }

    @Test fun recognizesVolumeCommandsInEnglishAndHindi() {
        assertEquals(LocalSystemCommand.VolumeUp, SystemControlCommandParser.parse("volume up"))
        assertEquals(LocalSystemCommand.VolumeUp, SystemControlCommandParser.parse("आवाज़ बढ़ाओ"))
        assertEquals(LocalSystemCommand.VolumeDown, SystemControlCommandParser.parse("volume kam karo"))
        assertEquals(LocalSystemCommand.Mute, SystemControlCommandParser.parse("mute"))
        assertEquals(LocalSystemCommand.Unmute, SystemControlCommandParser.parse("unmute"))
        assertEquals(LocalSystemCommand.SetVolume(75), SystemControlCommandParser.parse("set volume to 75%"))
        assertEquals(LocalSystemCommand.SetVolume(0), SystemControlCommandParser.parse("volume 0"))
        assertEquals(LocalSystemCommand.InvalidVolume(101), SystemControlCommandParser.parse("volume 101"))
    }

    @Test fun settingsNavigationDoesNotPretendToToggleProtectedRadios() {
        assertEquals(LocalSystemCommand.OpenSettings(SystemSettingsTarget.WIFI), SystemControlCommandParser.parse("open Wi-Fi settings"))
        assertEquals(LocalSystemCommand.OpenSettings(SystemSettingsTarget.BLUETOOTH, true), SystemControlCommandParser.parse("turn bluetooth on"))
        assertEquals(LocalSystemCommand.OpenSettings(SystemSettingsTarget.LOCATION, true), SystemControlCommandParser.parse("location band karo"))
        assertEquals(LocalSystemCommand.OpenSettings(SystemSettingsTarget.ACCESSIBILITY), SystemControlCommandParser.parse("accessibility settings kholo"))
    }

    @Test fun unsupportedAppAndAmbiguousRequestsRemainForOtherHandlers() {
        assertNull(SystemControlCommandParser.parse("open YouTube"))
        assertNull(SystemControlCommandParser.parse("turn off everything"))
        assertNull(SystemControlCommandParser.parse("do something on my tablet"))
    }
}

class LocalSystemControllerTest {
    private class FakePlatform : LocalSystemPlatform {
        var snapshot = DeviceSystemSnapshot(68, true, "Wi-Fi connected", 35)
        var increased = 0
        var decreased = 0
        var muted = 0
        var unmuted = 0
        var setVolume: Int? = null
        var openedSettings: SystemSettingsTarget? = null
        var settingsAvailable = true
        override fun readSnapshot() = snapshot
        override fun increaseMediaVolume() { increased++ }
        override fun decreaseMediaVolume() { decreased++ }
        override fun muteMediaVolume() { muted++ }
        override fun unmuteMediaVolume() { unmuted++ }
        override fun setMediaVolume(percent: Int) { setVolume = percent }
        override fun openSettings(target: SystemSettingsTarget): Boolean {
            openedSettings = target
            return settingsAvailable
        }
    }

    @Test fun dispatchesVolumeAndStatusLocallyThroughOnePlatformBoundary() {
        val platform = FakePlatform()
        val controller = LocalSystemController(platform)
        assertEquals("Media volume increased.", controller.handle("volume up"))
        assertEquals("Media volume decreased.", controller.handle("volume down"))
        assertEquals("Media volume muted.", controller.handle("mute"))
        assertEquals("Media volume unmuted.", controller.handle("unmute"))
        assertEquals("Media volume set to 40%.", controller.handle("volume 40"))
        assertEquals(1, platform.increased)
        assertEquals(1, platform.decreased)
        assertEquals(1, platform.muted)
        assertEquals(1, platform.unmuted)
        assertEquals(40, platform.setVolume)
        assertTrue(controller.handle("device status")!!.contains("battery 68% (charging)"))
        assertTrue(controller.handle("device status")!!.contains("network Wi-Fi connected"))
        assertTrue(controller.handle("device status")!!.contains("media volume 35%"))
    }

    @Test fun connectivityToggleRequestsOnlyOpenAndroidSettings() {
        val platform = FakePlatform()
        val controller = LocalSystemController(platform)
        val reply = controller.handle("turn off Wi-Fi")!!
        assertEquals(SystemSettingsTarget.WIFI, platform.openedSettings)
        assertTrue(reply.contains("change Wi-Fi yourself"))
        assertTrue(reply.contains("settings page is open"))
    }

    @Test fun invalidVolumeAndUnknownCommandsCauseNoPlatformAction() {
        val platform = FakePlatform()
        val controller = LocalSystemController(platform)
        assertTrue(controller.handle("set volume to 101")!!.contains("0 to 100"))
        assertNull(controller.handle("open YouTube"))
        assertEquals(0, platform.increased)
        assertEquals(null, platform.setVolume)
        assertEquals(null, platform.openedSettings)
    }

    @Test fun unavailableSettingsPageIsReportedHonestly() {
        val platform = FakePlatform().apply { settingsAvailable = false }
        val controller = LocalSystemController(platform)
        assertTrue(controller.handle("open Bluetooth settings")!!.contains("could not open"))
    }
}
