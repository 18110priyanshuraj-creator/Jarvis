package com.priyanshuraj.jarviscompanion.accessibility

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import android.view.accessibility.AccessibilityNodeInfo
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Reads a bounded summary only after an explicit user request.
 * A visual read uses one screenshot and bundled on-device OCR. Nothing is saved or uploaded.
 */
object ScreenObserver {
    private const val MAX_NODES = 150
    private const val MAX_TREE_LINES = 24
    private const val MAX_DEPTH = 18
    private const val MAX_IMAGE_DIMENSION = 1920
    private const val MIN_CAPTURE_INTERVAL_MS = 1500L

    private val mainHandler = Handler(Looper.getMainLooper())
    private val mainExecutor = Executor { command -> mainHandler.post(command) }
    private val ocrExecutor = Executors.newSingleThreadExecutor()
    private val captureInProgress = AtomicBoolean(false)
    private val lastCaptureAt = AtomicLong(0L)

    fun describe(root: AccessibilityNodeInfo?): String {
        if (root == null) {
            return "I cannot access the current screen. Check that JARVIS screen access is enabled."
        }

        val lines = linkedSetOf<String>()
        var visited = 0

        fun visit(node: AccessibilityNodeInfo, depth: Int) {
            if (visited >= MAX_NODES || depth > MAX_DEPTH || !node.isVisibleToUser) return
            visited++

            val line = when {
                node.isPassword -> "Protected input field"
                node.isEditable -> {
                    val hint = node.hintText?.toString()?.trim().orEmpty()
                    if (hint.isBlank()) "Text input field" else "Text input: " + hint
                }
                else -> {
                    val text = node.text?.toString()?.trim().orEmpty()
                    val description = node.contentDescription?.toString()?.trim().orEmpty()
                    (if (text.isNotBlank()) text else description).take(180)
                }
            }

            if (line.isNotBlank()) lines.add(line)
            if (lines.size < MAX_TREE_LINES) {
                for (index in 0 until node.childCount) {
                    val child = node.getChild(index) ?: continue
                    visit(child, depth + 1)
                    if (lines.size >= MAX_TREE_LINES || visited >= MAX_NODES) break
                }
            }
        }

        visit(root, 0)
        return ScreenObservationText.format(lines.joinToString("\n"), emptyList())
    }

    /**
     * Captures at most one display frame after a direct voice request. Screenshot and OCR work
     * stays in memory on the device; callbacks are delivered on the main thread.
     */
    fun observeOnce(service: AccessibilityService, onComplete: (String) -> Unit) {
        val treeSummary = describe(service.rootInActiveWindow)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            deliver(onComplete, "Visual screen reading needs Android 11 or later. " + treeSummary)
            return
        }

        val now = SystemClock.elapsedRealtime()
        val previous = lastCaptureAt.get()
        if (previous > 0L && now - previous < MIN_CAPTURE_INTERVAL_MS) {
            deliver(onComplete, "Please wait a moment before requesting another screen read. " + treeSummary)
            return
        }
        if (!captureInProgress.compareAndSet(false, true)) {
            deliver(onComplete, "A screen read is already in progress. " + treeSummary)
            return
        }
        lastCaptureAt.set(now)

        val delivered = AtomicBoolean(false)
        fun finish(message: String) {
            if (!delivered.compareAndSet(false, true)) return
            captureInProgress.set(false)
            deliver(onComplete, message)
        }

        try {
            service.takeScreenshot(
                Display.DEFAULT_DISPLAY,
                mainExecutor,
                object : AccessibilityService.TakeScreenshotCallback {
                    override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
                        ocrExecutor.execute {
                            try {
                                val hardwareBuffer = screenshot.hardwareBuffer
                                val bitmap = try {
                                    val hardwareBitmap = Bitmap.wrapHardwareBuffer(
                                        hardwareBuffer,
                                        screenshot.colorSpace
                                    )
                                    val softwareBitmap = hardwareBitmap?.copy(Bitmap.Config.ARGB_8888, false)
                                    hardwareBitmap?.recycle()
                                    softwareBitmap
                                } finally {
                                    hardwareBuffer.close()
                                }

                                if (bitmap == null) {
                                    finish("Android captured the screen but could not prepare the image. " + treeSummary)
                                    return@execute
                                }
                                runOcr(scaleForOcr(bitmap), treeSummary, ::finish)
                            } catch (_: Exception) {
                                finish("Visual screen reading was unavailable. Accessible labels only: " + treeSummary)
                            }
                        }
                    }

                    override fun onFailure(errorCode: Int) {
                        finish(
                            "Android did not provide a screenshot. The app may protect its window, or visual capture may be unavailable. " +
                                "Accessible labels only: " + treeSummary
                        )
                    }
                }
            )
        } catch (_: Exception) {
            finish("Android could not start a one-time screen capture. Accessible labels only: " + treeSummary)
        }
    }

    private fun scaleForOcr(bitmap: Bitmap): Bitmap {
        val largest = maxOf(bitmap.width, bitmap.height)
        if (largest <= MAX_IMAGE_DIMENSION) return bitmap
        val scale = MAX_IMAGE_DIMENSION.toFloat() / largest.toFloat()
        val width = (bitmap.width * scale).toInt().coerceAtLeast(1)
        val height = (bitmap.height * scale).toInt().coerceAtLeast(1)
        val scaled = Bitmap.createScaledBitmap(bitmap, width, height, true)
        if (scaled !== bitmap) bitmap.recycle()
        return scaled
    }

    private fun runOcr(
        bitmap: Bitmap,
        treeSummary: String,
        finish: (String) -> Unit
    ) {
        val latin: TextRecognizer
        val devanagari: TextRecognizer
        val input: InputImage
        try {
            latin = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            devanagari = TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
            input = InputImage.fromBitmap(bitmap, 0)
        } catch (_: Exception) {
            bitmap.recycle()
            finish("On-device text recognition could not start. Accessible labels only: " + treeSummary)
            return
        }

        val released = AtomicBoolean(false)
        fun complete(latinLines: List<String>, devanagariLines: List<String>) {
            if (!released.compareAndSet(false, true)) return
            runCatching { latin.close() }
            runCatching { devanagari.close() }
            bitmap.recycle()

            val visualLines = latinLines + devanagariLines
            val summary = ScreenObservationText.format(treeSummary, visualLines)
            val preface = if (visualLines.isEmpty()) {
                "I checked one screen image on this device but could not recognize readable visual text. OCR may miss text. "
            } else {
                "I read one screen image on this device. OCR can miss or misread text. Nothing was saved or uploaded. "
            }
            finish(preface + summary)
        }

        fun runDevanagari(latinLines: List<String>) {
            try {
                devanagari.process(input).addOnCompleteListener(ocrExecutor) { task ->
                    val lines = if (task.isSuccessful) {
                        task.result.textBlocks.flatMap { block -> block.lines.map { line -> line.text } }
                    } else {
                        emptyList()
                    }
                    complete(latinLines, lines)
                }
            } catch (_: Exception) {
                complete(latinLines, emptyList())
            }
        }

        try {
            latin.process(input).addOnCompleteListener(ocrExecutor) { task ->
                val lines = if (task.isSuccessful) {
                    task.result.textBlocks.flatMap { block -> block.lines.map { line -> line.text } }
                } else {
                    emptyList()
                }
                runDevanagari(lines)
            }
        } catch (_: Exception) {
            runDevanagari(emptyList())
        }
    }

    private fun deliver(onComplete: (String) -> Unit, message: String) {
        mainHandler.post { onComplete(message) }
    }
}
