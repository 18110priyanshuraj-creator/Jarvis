package com.priyanshuraj.jarviscompanion

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceNativeCommandPolicyTest {
    @Test
    fun acceptsExplicitInstalledAppLaunches() {
        assertTrue(WorkspaceNativeCommandPolicy.isInstalledAppLaunchRequest("Jarvis, open Canva"))
        assertTrue(WorkspaceNativeCommandPolicy.isInstalledAppLaunchRequest("launch Chrome"))
        assertTrue(WorkspaceNativeCommandPolicy.isInstalledAppLaunchRequest("please start Messages"))
    }

    @Test
    fun rejectsWebsitesAndNonLaunchRequests() {
        assertFalse(WorkspaceNativeCommandPolicy.isInstalledAppLaunchRequest("open https://canva.com"))
        assertFalse(WorkspaceNativeCommandPolicy.isInstalledAppLaunchRequest("search Google for Canva"))
        assertFalse(WorkspaceNativeCommandPolicy.isInstalledAppLaunchRequest("Jarvis, tap Save"))
    }
}
