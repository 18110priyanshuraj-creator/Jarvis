package com.priyanshuraj.jarviscompanion

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.cos
import kotlin.math.sin

/**
 * Lightweight, native JARVIS orb for the launcher/home screen.
 *
 * Animation is view-lifecycle-bound: it runs while attached and is cancelled
 * when the Activity removes the view. It does not use the microphone.
 */
class OrbitalOrbView(context: Context) : View(context) {
    private var rotationDegrees = 0f
    private var listening = false

    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = resources.displayMetrics.density * 1.2f
        color = Color.argb(100, 76, 213, 245)
    }
    private val brightRingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = resources.displayMetrics.density * 2.0f
        color = Color.argb(180, 117, 239, 255)
        strokeCap = Paint.Cap.ROUND
    }
    private val nodePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(174, 247, 255)
        style = Paint.Style.FILL
    }
    private val highlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(150, 238, 255, 255)
        style = Paint.Style.FILL
    }

    private val animator = ValueAnimator.ofFloat(0f, 360f).apply {
        duration = 12000L
        repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener { value ->
            rotationDegrees = value.animatedValue as Float
            invalidate()
        }
    }

    init {
        isClickable = true
        isFocusable = true
        contentDescription = "JARVIS animated orb"
    }

    fun setListening(active: Boolean) {
        if (listening == active) return
        listening = active
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val side = minOf(width, height).toFloat()
        if (side <= 0f) return

        val cx = width / 2f
        val cy = height / 2f
        val radius = side * 0.265f
        val pulseWave = sin(Math.toRadians((rotationDegrees * 2f).toDouble())).toFloat()
        val pulse = 1f + (if (listening) 0.035f else 0.014f) * pulseWave
        val orbRadius = radius * pulse

        val haloPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(
                cx, cy, radius * 1.72f,
                intArrayOf(Color.argb(105, 0, 205, 250), Color.argb(38, 0, 125, 185), Color.TRANSPARENT),
                floatArrayOf(0f, 0.56f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawCircle(cx, cy, radius * 1.72f, haloPaint)

        val oval = RectF(cx - radius * 1.32f, cy - radius * 0.72f, cx + radius * 1.32f, cy + radius * 0.72f)
        canvas.save()
        canvas.rotate(rotationDegrees * 0.62f, cx, cy)
        canvas.drawOval(oval, ringPaint)
        canvas.drawArc(oval, 18f, 92f, false, brightRingPaint)
        canvas.restore()

        val secondOval = RectF(cx - radius * 1.18f, cy - radius * 0.92f, cx + radius * 1.18f, cy + radius * 0.92f)
        canvas.save()
        canvas.rotate(-rotationDegrees * 0.78f, cx, cy)
        canvas.drawOval(secondOval, ringPaint)
        canvas.drawArc(secondOval, 205f, 54f, false, brightRingPaint)
        canvas.restore()

        val nodeAngle = Math.toRadians((rotationDegrees + 35f).toDouble())
        canvas.drawCircle(
            cx + cos(nodeAngle).toFloat() * radius * 1.32f,
            cy + sin(nodeAngle).toFloat() * radius * 0.72f,
            radius * 0.055f,
            nodePaint
        )
        val secondNodeAngle = Math.toRadians((-rotationDegrees * 0.78f + 215f).toDouble())
        canvas.drawCircle(
            cx + cos(secondNodeAngle).toFloat() * radius * 1.18f,
            cy + sin(secondNodeAngle).toFloat() * radius * 0.92f,
            radius * 0.038f,
            highlightPaint
        )

        val orbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(
                cx - orbRadius * 0.28f,
                cy - orbRadius * 0.30f,
                orbRadius * 1.36f,
                intArrayOf(
                    Color.rgb(225, 255, 255),
                    Color.rgb(95, 221, 246),
                    Color.rgb(20, 123, 179),
                    Color.rgb(4, 33, 70),
                    Color.rgb(1, 10, 25)
                ),
                floatArrayOf(0f, 0.18f, 0.46f, 0.78f, 1f),
                Shader.TileMode.CLAMP
            )
        }
        canvas.drawCircle(cx, cy, orbRadius, orbPaint)

        val innerGlowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(if (listening) 82 else 46, 117, 242, 255)
            style = Paint.Style.STROKE
            strokeWidth = radius * 0.035f
        }
        canvas.drawCircle(cx, cy, orbRadius * 0.78f, innerGlowPaint)
        canvas.drawOval(
            RectF(cx - orbRadius * 0.50f, cy - orbRadius * 0.56f, cx - orbRadius * 0.02f, cy - orbRadius * 0.27f),
            highlightPaint
        )
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (!animator.isStarted) animator.start()
    }

    override fun onDetachedFromWindow() {
        animator.cancel()
        super.onDetachedFromWindow()
    }
}
