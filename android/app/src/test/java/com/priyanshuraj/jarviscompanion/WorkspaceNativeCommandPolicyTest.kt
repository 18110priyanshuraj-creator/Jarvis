package com.priyanshuraj.jarviscompanion

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceNativeCommandPolicyTest {
    @Test
    fun acceptsDirectLaunchRequestsWithoutExactWording() {
        assertTrue(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("Jarvis, open Canva"))
        assertTrue(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("launch Chrome"))
        assertTrue(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("Canva kholo"))
        assertTrue(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("Canva khol do"))
        assertTrue(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("mujhe Canva chalao"))
        assertTrue(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("take me to CapCut"))
    }

    @Test
    fun acceptsNaturalLanguageCreativeTasksForKnownApps() {
        assertTrue(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("Canva mein stick figure animation banao"))
        assertTrue(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("I want to edit a video in Canva"))
        assertTrue(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("Please create a thumbnail using Canva"))
        assertTrue(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("CapCut par video edit karna hai"))
    }

    @Test
    fun keepsQuestionsAndUnrelatedChatInTheWebWorkspace() {
        assertFalse(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("What is Canva?"))
        assertFalse(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("How do I edit a video in Canva?"))
        assertFalse(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("search Google for Canva"))
        assertFalse(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("hello Jarvis"))
    }

    @Test
    fun rejectsWebsitesAsAppNames() {
        assertFalse(WorkspaceNativeCommandPolicy.isNativeAppTaskRequest("open https://canva.com"))
    }
}
