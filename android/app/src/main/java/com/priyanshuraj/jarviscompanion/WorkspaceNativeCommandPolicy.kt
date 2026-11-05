package com.priyanshuraj.jarviscompanion

/** Detects clear Android app tasks without requiring one exact spoken sentence. */
internal object WorkspaceNativeCommandPolicy {
    private val directOpenPrefix = Regex(
        """(?i)^(?:jarvis[\s,:;-]+)?(?:please\s+)?(?:can\s+you\s+)?(?:open|launch|start|run|go\s+to|take\s+me\s+to)\s+[\p{L}\p{N}][\p{L}\p{N} ._()+-]{0,79}$"""
    )
    private val directOpenSuffix = Regex(
        """(?i)^(?:jarvis[\s,:;-]+)?(?:please\s+)?(?:mujhe\s+)?[\p{L}\p{N}][\p{L}\p{N} ._()+-]{0,79}\s+(?:ko\s+)?(?:kholo|khol\s+do|open\s+karo|launch\s+karo|chalao|start\s+karo|shuru\s+karo)$"""
    )
    private val appAliases = listOf(
        "canva", "capcut", "cap cut", "inshot", "vn editor", "kinemaster",
        "adobe express", "youtube", "youtube studio", "chrome", "google chrome",
        "whatsapp", "instagram", "google photos", "photos", "gallery", "camera",
        "google drive", "drive", "files", "file manager"
    )
    private val taskVerb = Regex(
        """(?i)\b(?:edit\w*|creat\w*|mak\w*|design\w*|build\w*|prepar\w*|produc\w*|animat\w*|render\w*|export\w*|search\w*|find\w*|add\w*|bana\w*|taiyar\w*|dhund\w*|dhoond\w*)\b"""
    )
    private val taskObject = Regex(
        """(?i)\b(?:video\w*|animation\w*|stick[ -]?figure\w*|thumbnail\w*|poster\w*|reel\w*|shorts?\w*|clip\w*|storyboard\w*|template\w*|scene\w*|photo\w*|image\w*|design\w*|graphic\w*|intro\w*|outro\w*)\b"""
    )
    private val helpQuestion = Regex(
        """(?i)^(?:how\s+do\s+i|how\s+can\s+i|how\s+to|what\s+is|what\s+are|why\s+does|tell\s+me\s+about|kaise\s+use|kya\s+hai)\b"""
    )

    /**
     * A positive result means the request should be handed to Android's native
     * planner. The planner still validates and previews device actions before use.
     */
    fun isNativeAppTaskRequest(message: String): Boolean {
        val command = message.trim().trimEnd('.', '!', '?', '।', '॥')
        if (command.length !in 1..1000) return false
        if (directOpenPrefix.matches(command) || directOpenSuffix.matches(command)) return true
        if (helpQuestion.containsMatchIn(command)) return false

        val mentionsApp = appAliases.any { alias ->
            Regex("""(?i)(?<![\p{L}\p{N}])${Regex.escape(alias)}(?![\p{L}\p{N}])""")
                .containsMatchIn(command)
        }
        return mentionsApp && taskVerb.containsMatchIn(command) && taskObject.containsMatchIn(command)
    }
}
