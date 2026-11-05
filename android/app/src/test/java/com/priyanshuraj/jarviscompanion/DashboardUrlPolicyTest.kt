package com.priyanshuraj.jarviscompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DashboardUrlPolicyTest {
    @Test
    fun normalizesHttpsOriginAndTrailingSlash() {
        assertEquals("https://jarvis.example", DashboardUrlPolicy.normalizeBaseUrl(" HTTPS://JARVIS.EXAMPLE/ "))
        assertEquals("https://jarvis.example", DashboardUrlPolicy.normalizeBaseUrl("https://jarvis.example:443"))
    }

    @Test
    fun rejectsInsecureOrAmbiguousBaseUrls() {
        assertEquals(null, DashboardUrlPolicy.normalizeBaseUrl("http://jarvis.example"))
        assertEquals(null, DashboardUrlPolicy.normalizeBaseUrl("https://user:pass@jarvis.example"))
        assertEquals(null, DashboardUrlPolicy.normalizeBaseUrl("https://jarvis.example/private"))
        assertEquals(null, DashboardUrlPolicy.normalizeBaseUrl("https://jarvis.example?next=elsewhere"))
        assertEquals(null, DashboardUrlPolicy.normalizeBaseUrl("https://jarvis.example:8443"))
        assertEquals(null, DashboardUrlPolicy.normalizeBaseUrl("not a url"))
    }

    @Test
    fun allowsOnlyTheConfiguredWorkspaceOriginInWebView() {
        val base = "https://jarvis.example"
        assertTrue(DashboardUrlPolicy.allowsInAppNavigation("https://jarvis.example/memory", base))
        assertFalse(DashboardUrlPolicy.allowsInAppNavigation("https://accounts.google.com/o/oauth2/auth", base))
        assertFalse(DashboardUrlPolicy.allowsInAppNavigation("https://consent.google.com/", base))
        assertFalse(DashboardUrlPolicy.allowsInAppNavigation("https://oauth2.googleapis.com/token", base))
        assertFalse(DashboardUrlPolicy.allowsInAppNavigation("https://jarvis.example.evil.test/", base))
        assertFalse(DashboardUrlPolicy.allowsInAppNavigation("http://jarvis.example/", base))
        assertFalse(DashboardUrlPolicy.allowsInAppNavigation("file:///etc/passwd", base))
    }

    @Test
    fun GoogleOAuthLaunchTicketsAreSentToTheExternalBrowser() {
        val base = "https://jarvis.example"
        assertTrue(DashboardUrlPolicy.isOAuthBrowserHandoffUrl(
            "https://jarvis.example/api/integrations/google_drive/oauth/launch?ticket=abc123",
            base
        ))
        assertFalse(DashboardUrlPolicy.isOAuthBrowserHandoffUrl(
            "https://accounts.google.com/o/oauth2/auth?ticket=abc123",
            base
        ))
        assertFalse(DashboardUrlPolicy.isOAuthBrowserHandoffUrl(
            "https://jarvis.example/api/integrations/google_drive/oauth/callback?ticket=abc123",
            base
        ))
        assertFalse(DashboardUrlPolicy.isOAuthBrowserHandoffUrl(
            "https://jarvis.example/api/integrations/google_drive/oauth/launch",
            base
        ))
    }

    @Test
    fun workspaceJavaScriptDialogsAreLimitedToTheConfiguredOrigin() {
        val base = "https://jarvis.example"
        assertTrue(DashboardUrlPolicy.isWorkspaceOrigin("https://jarvis.example/actions", base))
        assertFalse(DashboardUrlPolicy.isWorkspaceOrigin("https://accounts.google.com/signin", base))
        assertFalse(DashboardUrlPolicy.isWorkspaceOrigin("https://jarvis.example.evil.test/", base))
        assertFalse(DashboardUrlPolicy.isWorkspaceOrigin("http://jarvis.example/", base))
    }

    @Test
    fun externalLinksMustUseHttpsAndAStandardPort() {
        assertTrue(DashboardUrlPolicy.isSafeExternalHttpsUrl("https://example.org/article"))
        assertFalse(DashboardUrlPolicy.isSafeExternalHttpsUrl("http://example.org/article"))
        assertFalse(DashboardUrlPolicy.isSafeExternalHttpsUrl("javascript:alert(1)"))
        assertFalse(DashboardUrlPolicy.isSafeExternalHttpsUrl("https://user@example.org/"))
        assertFalse(DashboardUrlPolicy.isSafeExternalHttpsUrl("https://example.org:9443/"))
    }

    @Test
    fun deployedVercelWorkspaceIsAValidDefaultOrigin() {
        assertEquals(DEFAULT_WORKSPACE_URL, DashboardUrlPolicy.normalizeBaseUrl(DEFAULT_WORKSPACE_URL))
        assertTrue(DashboardUrlPolicy.allowsInAppNavigation("$DEFAULT_WORKSPACE_URL/", DEFAULT_WORKSPACE_URL))
        assertFalse(DashboardUrlPolicy.allowsInAppNavigation("https://example.com/", DEFAULT_WORKSPACE_URL))
    }
}
