package com.priyanshuraj.jarviscompanion.accessibility

import android.graphics.Rect
import android.os.Bundle
import android.text.InputType
import android.view.accessibility.AccessibilityNodeInfo
import java.util.LinkedHashMap

enum class UiActionCode {
    SUCCESS,
    EMPTY_TARGET,
    PROTECTED_CONTROL,
    PROTECTED_SCREEN,
    NO_ACCESSIBLE_WINDOW,
    TARGET_NOT_FOUND,
    AMBIGUOUS_TARGET,
    TARGET_DISABLED,
    ACTION_REJECTED,
    EMPTY_TEXT,
    TEXT_TOO_LONG,
    SENSITIVE_TEXT,
    FIELD_UNAVAILABLE,
    FIELD_PROTECTED,
    FIELD_NOT_EDITABLE,
    SCROLL_AREA_NOT_FOUND,
    SYSTEM_ACTION_REJECTED
}

data class UiActionResult(
    val ok: Boolean,
    val message: String,
    val code: UiActionCode = if (ok) UiActionCode.SUCCESS else UiActionCode.ACTION_REJECTED,
    val retryable: Boolean = false
)

/**
 * Bounded, exact-target Android actions.
 *
 * Targets are inspected from the current accessibility window only. No coordinates,
 * arbitrary gestures, scripts, or automatic submit/send actions are supported.
 */
object UIActionExecutor {
    private const val MAX_NODES = 180
    private const val MAX_DEPTH = 18
    private const val MAX_CONTEXT_DEPTH = 6
    private const val MAX_TEXT_LENGTH = 300

    private data class VisibleTree(
        val nodes: List<AccessibilityNodeInfo>,
        val labels: List<String>
    ) {
        fun recycleNodes() {
            nodes.forEach { runCatching { it.recycle() } }
        }
    }

    fun clickExactLabel(service: JarvisAccessibilityService, requestedLabel: String): UiActionResult {
        val label = requestedLabel.trim().trim('"', '\'')
        if (label.isBlank()) {
            return failure(UiActionCode.EMPTY_TARGET, "Tell me the exact visible button or item label.")
        }

        val root = service.rootInActiveWindow
            ?: return failure(
                UiActionCode.NO_ACCESSIBLE_WINDOW,
                "The current app did not expose an accessible screen.",
                retryable = true
            )

        try {
            val tree = collectVisibleTree(root)
            val targets = LinkedHashMap<String, AccessibilityNodeInfo>()
            val allMatchingTargets = linkedSetOf<String>()
            var disabledTargetFound = false
            var protectedTargetFound = false

            try {
                if (UiActionPolicy.isProtectedScreen(tree.labels)) {
                    return failure(
                        UiActionCode.PROTECTED_SCREEN,
                        "This screen may contain credentials or verification details. Complete its controls manually."
                    )
                }

                for (node in tree.nodes) {
                    if (node.isPassword || !UiActionPolicy.matchesExactLabel(
                            node.text?.toString(),
                            node.contentDescription?.toString(),
                            label
                        )
                    ) continue

                    val clickable = nearestClickableCopy(node) ?: continue
                    val context = ancestorLabels(clickable)
                    val key = targetKey(clickable)
                    allMatchingTargets += key

                    val decision = UiActionPolicy.validateTap(
                        requestedLabel = label,
                        contextLabels = context,
                        visible = clickable.isVisibleToUser,
                        enabled = clickable.isEnabled,
                        clickable = clickable.isClickable
                    )
                    if (!decision.allowed) {
                        if (decision.code == UiActionPolicyCode.PROTECTED_CONTROL ||
                            decision.code == UiActionPolicyCode.PROTECTED_SCREEN
                        ) protectedTargetFound = true
                        if (decision.code == UiActionPolicyCode.TARGET_DISABLED ||
                            decision.code == UiActionPolicyCode.TARGET_NOT_VISIBLE
                        ) disabledTargetFound = true
                        clickable.recycle()
                        continue
                    }

                    val previous = targets.putIfAbsent(key, clickable)
                    if (previous != null) clickable.recycle()
                }

                if (protectedTargetFound) {
                    return failure(
                        UiActionCode.PROTECTED_CONTROL,
                        "This control or its parent appears consequential or security-sensitive. Please complete it manually."
                    )
                }
                if (allMatchingTargets.size > 1) {
                    return failure(
                        UiActionCode.AMBIGUOUS_TARGET,
                        "I found more than one item named " + label + ". Please use a more specific visible label."
                    )
                }
                if (targets.isEmpty()) {
                    return if (disabledTargetFound) {
                        failure(UiActionCode.TARGET_DISABLED, "The matching item is disabled or not currently visible.")
                    } else {
                        failure(
                            UiActionCode.TARGET_NOT_FOUND,
                            "I could not find a safe, clickable item with the exact label: " + label + ".",
                            retryable = true
                        )
                    }
                }

                val target = targets.values.first()
                val accepted = target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                return if (accepted) {
                    success("Android accepted the tap request for " + label + ".")
                } else {
                    failure(
                        UiActionCode.ACTION_REJECTED,
                        "Android rejected the tap request. The screen may have changed; review it and try again.",
                        retryable = true
                    )
                }
            } finally {
                tree.recycleNodes()
                targets.values.forEach { runCatching { it.recycle() } }
            }
        } finally {
            runCatching { root.recycle() }
        }
    }

    fun typeIntoFocusedField(service: JarvisAccessibilityService, text: String): UiActionResult {
        val value = text.trim()
        val payload = UiActionPolicy.validateTextPayload(value, MAX_TEXT_LENGTH)
        if (!payload.allowed) return fromPolicy(payload)

        val root = service.rootInActiveWindow
            ?: return failure(
                UiActionCode.NO_ACCESSIBLE_WINDOW,
                "The current app did not expose an accessible screen.",
                retryable = true
            )

        try {
            val tree = collectVisibleTree(root)
            try {
                if (UiActionPolicy.isProtectedScreen(tree.labels)) {
                    return failure(
                        UiActionCode.PROTECTED_SCREEN,
                        "This screen may contain a password, PIN or verification code. Enter sensitive information manually."
                    )
                }

                val focused = service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
                    ?: return failure(
                        UiActionCode.FIELD_UNAVAILABLE,
                        "Tap the intended text field yourself first, then ask me to type.",
                        retryable = true
                    )

                try {
                    val password = focused.isPassword || isPasswordInput(focused.inputType)
                    val decision = UiActionPolicy.validateTextTarget(
                        visible = focused.isVisibleToUser,
                        enabled = focused.isEnabled,
                        editable = focused.isEditable,
                        password = password,
                        screenLabels = tree.labels
                    )
                    if (!decision.allowed) return fromPolicy(decision)

                    val arguments = Bundle().apply {
                        putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
                    }
                    val updated = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
                    return if (updated) {
                        success("Android accepted text entry. I have not pressed Send or Submit.")
                    } else {
                        failure(
                            UiActionCode.ACTION_REJECTED,
                            "The focused field rejected text entry. Check the screen and try again.",
                            retryable = true
                        )
                    }
                } finally {
                    runCatching { focused.recycle() }
                }
            } finally {
                tree.recycleNodes()
            }
        } finally {
            runCatching { root.recycle() }
        }
    }

    fun scroll(service: JarvisAccessibilityService, forward: Boolean): UiActionResult {
        val root = service.rootInActiveWindow
            ?: return failure(
                UiActionCode.NO_ACCESSIBLE_WINDOW,
                "The current app did not expose an accessible screen.",
                retryable = true
            )
        try {
            val tree = collectVisibleTree(root)
            try {
                val action = if (forward) {
                    AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                } else {
                    AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                }
                for (node in tree.nodes.asReversed()) {
                    val decision = UiActionPolicy.validateScrollTarget(
                        visible = node.isVisibleToUser,
                        enabled = node.isEnabled,
                        scrollable = node.isScrollable
                    )
                    if (!decision.allowed) continue
                    if (node.performAction(action)) {
                        return success(
                            if (forward) "Android accepted the scroll-down request."
                            else "Android accepted the scroll-up request."
                        )
                    }
                }
                return failure(
                    UiActionCode.SCROLL_AREA_NOT_FOUND,
                    "I could not find an enabled, visible scrollable area on this screen.",
                    retryable = true
                )
            } finally {
                tree.recycleNodes()
            }
        } finally {
            runCatching { root.recycle() }
        }
    }

    fun goBack(service: JarvisAccessibilityService): UiActionResult {
        val accepted = service.performGlobalAction(
            android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK
        )
        return if (accepted) {
            success("Android accepted the Back request.")
        } else {
            failure(
                UiActionCode.SYSTEM_ACTION_REJECTED,
                "Android could not perform the Back action from this screen.",
                retryable = true
            )
        }
    }

    fun goHome(service: JarvisAccessibilityService): UiActionResult {
        val accepted = service.performGlobalAction(
            android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME
        )
        return if (accepted) {
            success("Android accepted the Home request.")
        } else {
            failure(
                UiActionCode.SYSTEM_ACTION_REJECTED,
                "Android could not perform the Home action.",
                retryable = true
            )
        }
    }

    private fun collectVisibleTree(root: AccessibilityNodeInfo): VisibleTree {
        val nodes = mutableListOf<AccessibilityNodeInfo>()
        val labels = linkedSetOf<String>()

        fun visit(node: AccessibilityNodeInfo, depth: Int) {
            if (depth > MAX_DEPTH || nodes.size >= MAX_NODES || !node.isVisibleToUser) return

            nodes += AccessibilityNodeInfo.obtain(node)
            val text = node.text?.toString()?.trim().orEmpty()
            val description = node.contentDescription?.toString()?.trim().orEmpty()
            val hint = node.hintText?.toString()?.trim().orEmpty()
            if (node.isPassword) labels += "Password field"
            if (text.isNotBlank()) labels += text
            if (description.isNotBlank()) labels += description
            if (hint.isNotBlank()) labels += hint

            for (index in 0 until node.childCount) {
                if (nodes.size >= MAX_NODES) break
                val child = node.getChild(index) ?: continue
                try {
                    visit(child, depth + 1)
                } finally {
                    runCatching { child.recycle() }
                }
            }
        }

        visit(root, 0)
        return VisibleTree(nodes, labels.toList())
    }

    /**
     * Returns an owned copy of the nearest clickable node. Every intermediate parent copy is
     * recycled before walking farther up the accessibility tree.
     */
    private fun nearestClickableCopy(start: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = AccessibilityNodeInfo.obtain(start)
        var depth = 0
        while (current != null && depth <= MAX_CONTEXT_DEPTH) {
            if (current.isClickable) return current
            val item = current
            val parent = item.parent
            runCatching { item.recycle() }
            current = parent
            depth++
        }
        current?.recycle()
        return null
    }

    private fun ancestorLabels(start: AccessibilityNodeInfo): List<String> {
        val labels = mutableListOf<String>()
        var current: AccessibilityNodeInfo? = AccessibilityNodeInfo.obtain(start)
        var depth = 0
        while (current != null && depth <= MAX_CONTEXT_DEPTH) {
            if (current.isPassword) labels += "Protected input field"
            current.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let(labels::add)
            current.contentDescription?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let(labels::add)
            current.hintText?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let(labels::add)
            val item = current
            val parent = item.parent
            runCatching { item.recycle() }
            current = parent
            depth++
        }
        current?.recycle()
        return labels
    }

    private fun targetKey(target: AccessibilityNodeInfo): String {
        val bounds = Rect()
        target.getBoundsInScreen(bounds)
        return listOf(
            bounds.left,
            bounds.top,
            bounds.right,
            bounds.bottom,
            target.className?.toString().orEmpty(),
            target.viewIdResourceName.orEmpty()
        ).joinToString(":")
    }

    private fun fromPolicy(decision: UiActionPolicyDecision): UiActionResult {
        val code = when (decision.code) {
            UiActionPolicyCode.EMPTY_TARGET -> UiActionCode.EMPTY_TARGET
            UiActionPolicyCode.PROTECTED_CONTROL -> UiActionCode.PROTECTED_CONTROL
            UiActionPolicyCode.PROTECTED_SCREEN -> UiActionCode.PROTECTED_SCREEN
            UiActionPolicyCode.TARGET_DISABLED -> UiActionCode.TARGET_DISABLED
            UiActionPolicyCode.EMPTY_TEXT -> UiActionCode.EMPTY_TEXT
            UiActionPolicyCode.TEXT_TOO_LONG -> UiActionCode.TEXT_TOO_LONG
            UiActionPolicyCode.SENSITIVE_TEXT -> UiActionCode.SENSITIVE_TEXT
            UiActionPolicyCode.FIELD_NOT_VISIBLE,
            UiActionPolicyCode.FIELD_DISABLED,
            UiActionPolicyCode.PASSWORD_FIELD -> UiActionCode.FIELD_PROTECTED
            UiActionPolicyCode.FIELD_NOT_EDITABLE -> UiActionCode.FIELD_NOT_EDITABLE
            UiActionPolicyCode.TARGET_NOT_VISIBLE -> UiActionCode.TARGET_NOT_FOUND
            UiActionPolicyCode.TARGET_NOT_CLICKABLE -> UiActionCode.ACTION_REJECTED
            UiActionPolicyCode.ALLOWED -> UiActionCode.SUCCESS
        }
        return UiActionResult(false, decision.explanation, code, retryable = false)
    }

    private fun isPasswordInput(inputType: Int): Boolean {
        val inputClass = inputType and InputType.TYPE_MASK_CLASS
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return when (inputClass) {
            InputType.TYPE_CLASS_TEXT -> variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }

    private fun success(message: String) =
        UiActionResult(true, message, UiActionCode.SUCCESS, retryable = false)

    private fun failure(code: UiActionCode, message: String, retryable: Boolean = false) =
        UiActionResult(false, message, code, retryable)
}
