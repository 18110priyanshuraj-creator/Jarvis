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
            "https://example.com/?access_token=secret",
            "https://example.com/callback?code=123456",
            "https://example.com/?api_key=private",
            "https://example.com/adult-content/",
            "https://example.com/search?q=porn",
            "https://example.com/store/weapon",
            "https://example.com/suicide-prevention/",
            "https://example.com/self-harm/",
            "https://example.com/drug/overdose",
            "https://router.home.arpa/",
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

    @Test
    fun rejectsAdditionalPrivateAndReservedNetworkAddresses() {
        listOf(
            "http://0.0.0.0/",
            "http://169.254.169.254/",
            "http://100.64.0.1/",
            "http://172.16.0.1/",
            "http://192.0.0.1/",
            "http://198.18.0.1/",
            "http://203.0.113.10/",
            "http://0177.0.0.1/",
            "http://[::1]/",
            "http://printer.local/",
            "https://router.internal/",
            "https://device.test/"
        ).forEach { assertNull(it, BrowserUrlPolicy.normalize(it)) }
    }

}
