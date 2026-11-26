package com.priyanshuraj.jarviscompanion.accessibility

/** Video editors that may use Android's semantic drag action when the app exposes it. */
internal object VideoEditorPolicy {
    fun canonicalName(value: String?): String? = when (UiActionPolicy.normalizeLabel(value.orEmpty())) {
        "canva" -> "Canva"
        "vn", "vn video editor", "vn video editor and maker", "vn photo and video editor" -> "VN"
        else -> null
    }

    fun packageName(value: String?): String? = when (canonicalName(value)) {
        "VN" -> "com.frontrow.vlog"
        else -> null
    }

    fun supportsSemanticDrag(value: String?): Boolean = canonicalName(value) != null
}
