package com.priyanshuraj.jarviscompanion.accessibility

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VideoEditorPolicyTest {
    @Test
    fun recognizesOnlySupportedVideoEditorNames() {
        assertEquals("Canva", VideoEditorPolicy.canonicalName(" Canva "))
        assertEquals("VN", VideoEditorPolicy.canonicalName("vn"))
        assertEquals("VN", VideoEditorPolicy.canonicalName("VN Video Editor"))
        assertEquals("com.frontrow.vlog", VideoEditorPolicy.packageName("VN"))
        assertEquals(null, VideoEditorPolicy.packageName("Canva"))
        assertTrue(VideoEditorPolicy.supportsSemanticDrag("VN"))
        assertFalse(VideoEditorPolicy.supportsSemanticDrag("Chrome"))
        assertFalse(VideoEditorPolicy.supportsSemanticDrag(""))
    }
}
