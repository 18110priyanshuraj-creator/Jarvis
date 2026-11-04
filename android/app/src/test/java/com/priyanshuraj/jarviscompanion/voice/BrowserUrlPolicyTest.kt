package com.priyanshuraj.jarviscompanion.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BrowserUrlPolicyTest {
    @Test
    fun acceptsHttpsAndHttpPublicWebsites() {
        assertEquals("https://www.canva.com/", BrowserUrlPolicy.normalize("www.canva.com"))
        assertEquals("https://example.com/editor", BrowserUrlPolicy.normalize("https://example.com/editor"))
        assertEquals("http://example.org/path", BrowserUrlPolicy.normalize("http://example.org/path"))
    }

    @Test
    fun rejectsNonWebSchemesAndCredentialBearingUrls() {
        listOf(
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,hello",
            "https://user:pass@example.com",
            "https://localhost/admin",
            "http://192.168.1.1",
            "http://10.0.0.4",
            "https://service.local",
            "not a url"
        ).forEach { assertNull(it, BrowserUrlPolicy.normalize(it)) }
    }

    @Test
    fun rejectsControlCharactersAndOversizedInputs() {
        assertNull(BrowserUrlPolicy.normalize("https://example.com/\nadmin"))
        assertNull(BrowserUrlPolicy.normalize("a".repeat(2049)))
    }
}
