package com.priyanshuraj.jarviscompanion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HomeLayoutPolicyTest {
    @Test
    fun phoneWidthsKeepOrbWithinAUsefulBound() {
        assertEquals(272, HomeLayoutPolicy.orbSizeDp(320))
        assertEquals(280, HomeLayoutPolicy.orbSizeDp(328))
        assertEquals(310, HomeLayoutPolicy.orbSizeDp(358))
    }

    @Test
    fun tabletBreakpointsUseLargerOrbAndCenteredContent() {
        assertEquals(340, HomeLayoutPolicy.orbSizeDp(600))
        assertEquals(380, HomeLayoutPolicy.orbSizeDp(900))
        assertEquals(600, HomeLayoutPolicy.contentMaxWidthDp(600))
        assertEquals(720, HomeLayoutPolicy.contentMaxWidthDp(1024))
    }

    @Test
    fun phoneContentUsesAvailableWidth() {
        assertNull(HomeLayoutPolicy.contentMaxWidthDp(599))
        assertEquals(24, HomeLayoutPolicy.horizontalPaddingDp(599))
        assertEquals(32, HomeLayoutPolicy.horizontalPaddingDp(600))
    }
}
