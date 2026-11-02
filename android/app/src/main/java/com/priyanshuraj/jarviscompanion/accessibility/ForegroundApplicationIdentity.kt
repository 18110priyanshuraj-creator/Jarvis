package com.priyanshuraj.jarviscompanion.accessibility

import java.util.Locale

/**
 * Converts the currently visible Android window package into bounded routing metadata.
 * This value scopes optional skill guidance only; it is not an authorization signal.
 */
internal object ForegroundApplicationIdentity {
    private val packagePattern = Regex("^[a-z0-9][a-z0-9._-]{0,79}$")

    fun resolve(packageName: String?, companionPackage: String): String? {
        val candidate = packageName?.trim()?.lowercase(Locale.ROOT).orEmpty()
        val ownPackage = companionPackage.trim().lowercase(Locale.ROOT)
        if (candidate.isBlank() || candidate == ownPackage) return null
        if (!packagePattern.matches(candidate)) return null
        return candidate
    }
}
