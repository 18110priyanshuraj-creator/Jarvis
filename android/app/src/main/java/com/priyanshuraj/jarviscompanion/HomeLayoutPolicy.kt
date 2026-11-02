package com.priyanshuraj.jarviscompanion

/**
 * Pure sizing rules for the native home surface. Kept independent of Android
 * Views so breakpoint behavior can be regression-tested on the JVM.
 */
internal object HomeLayoutPolicy {
    fun horizontalPaddingDp(screenWidthDp: Int): Int =
        if (screenWidthDp >= 600) 32 else 24

    fun orbSizeDp(screenWidthDp: Int): Int {
        if (screenWidthDp >= 900) return 380
        if (screenWidthDp >= 600) return 340
        return (screenWidthDp - horizontalPaddingDp(screenWidthDp) * 2).coerceIn(230, 310)
    }

    fun contentMaxWidthDp(screenWidthDp: Int): Int? =
        if (screenWidthDp >= 600) minOf(screenWidthDp, 720) else null
}
