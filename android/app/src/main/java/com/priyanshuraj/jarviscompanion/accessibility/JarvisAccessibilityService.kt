package com.priyanshuraj.jarviscompanion.accessibility

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

class JarvisAccessibilityService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val packageName = event.packageName?.toString().orEmpty()
        if (packageName.isBlank()) return

        // Phase 1 records only the foreground package and event type.
        // It does not inspect node text, screenshots, passwords, messages or other content.
        getSharedPreferences("jarvis_accessibility_status", MODE_PRIVATE)
            .edit()
            .putString("last_package", packageName)
            .putInt("last_event_type", event.eventType)
            .putLong("last_event_at", System.currentTimeMillis())
            .apply()
    }

    override fun onInterrupt() {
        // No ongoing gesture or action sequence exists in Phase 1.
    }
}
