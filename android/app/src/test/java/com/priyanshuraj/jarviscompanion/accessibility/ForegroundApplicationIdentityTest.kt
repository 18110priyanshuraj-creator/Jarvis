package com.priyanshuraj.jarviscompanion.accessibility

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ForegroundApplicationIdentityTest {
    @Test
    fun normalizesTheForegroundPackageId() {
        assertEquals(
            "com.android.chrome",
            ForegroundApplicationIdentity.resolve(" COM.Android.Chrome ", "com.priyanshuraj.jarviscompanion")
        )
    }

    @Test
    fun omitsJarvisAndUnavailableForegroundWindows() {
        assertNull(ForegroundApplicationIdentity.resolve(null, "com.priyanshuraj.jarviscompanion"))
        assertNull(ForegroundApplicationIdentity.resolve("", "com.priyanshuraj.jarviscompanion"))
        assertNull(ForegroundApplicationIdentity.resolve("com.priyanshuraj.jarviscompanion", "com.priyanshuraj.jarviscompanion"))
    }

    @Test
    fun rejectsMalformedPackageValues() {
        assertNull(ForegroundApplicationIdentity.resolve("com.example/app", "com.priyanshuraj.jarviscompanion"))
        assertNull(ForegroundApplicationIdentity.resolve("com.example package", "com.priyanshuraj.jarviscompanion"))
        assertNull(ForegroundApplicationIdentity.resolve("x".repeat(81), "com.priyanshuraj.jarviscompanion"))
    }
}
