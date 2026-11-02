package com.priyanshuraj.jarviscompanion.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityEvent

class JarvisAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        activeService = this
        serviceInfo = serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event != null) lastForegroundPackage = event.packageName?.toString().orEmpty()
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (activeService === this) activeService = null
        super.onDestroy()
    }

    companion object {
        @Volatile var activeService: JarvisAccessibilityService? = null
            private set
        @Volatile var lastForegroundPackage: String = ""
            private set

        /**
         * Reads only the active accessibility window's package identifier.
         * Returns null for JARVIS itself or unavailable/invalid foreground windows.
         */
        fun currentForegroundApplicationId(): String? {
            val service = activeService ?: return null
            val activePackage = runCatching {
                service.rootInActiveWindow?.packageName?.toString()
            }.getOrNull()
            return ForegroundApplicationIdentity.resolve(activePackage, service.packageName)
        }
    }
}
