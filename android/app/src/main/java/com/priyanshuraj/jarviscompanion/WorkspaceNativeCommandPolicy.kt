package com.priyanshuraj.jarviscompanion

/** Limits the Workspace-to-native bridge to explicit installed-app launch requests. */
internal object WorkspaceNativeCommandPolicy {
    private val appLaunchPattern = Regex(
        """(?i)^(?:jarvis[\\s,:;-]+)?(?:please\\s+)?(?:open|launch|start)\\s+[a-z0-9][a-z0-9 ._()+-]{0,59}$"""
    )

    fun isInstalledAppLaunchRequest(message: String): Boolean {
        val command = message.trim()
        return command.length in 1..120 && appLaunchPattern.matches(command)
    }
}
