package com.priyanshuraj.jarviscompanion.voice

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.priyanshuraj.jarviscompanion.R
import com.priyanshuraj.jarviscompanion.device.DeviceConnector
import com.priyanshuraj.jarviscompanion.device.DeviceTokenStore
import java.util.Locale
import java.util.concurrent.Executors

class VoiceControlService : Service() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val networkExecutor = Executors.newSingleThreadExecutor()
    private var recognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null
    private var ttsReady = false
    private var running = false
    private var stopAfterSpeech = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        textToSpeech = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true
                textToSpeech?.language = Locale("hi", "IN")
            }
        }
        textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}

            override fun onDone(utteranceId: String?) {
                mainHandler.post {
                    if (stopAfterSpeech) stopSelf() else scheduleListening(350)
                }
            }

            override fun onError(utteranceId: String?) {
                mainHandler.post {
                    if (stopAfterSpeech) stopSelf() else scheduleListening(500)
                }
            }
        })
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            running = false
            recognizer?.cancel()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        if (running) return START_NOT_STICKY
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            stopSelf()
            return START_NOT_STICKY
        }

        try {
            startAsForeground()
            running = true
            startListening()
        } catch (_: SecurityException) {
            running = false
            stopSelf()
        } catch (_: Exception) {
            running = false
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startAsForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, VoiceControlService::class.java).setAction(ACTION_STOP)
        val stopPendingIntent = PendingIntent.getService(
            this,
            STOP_REQUEST_CODE,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("JARVIS hands-free control is active")
            .setContentText("Microphone is active. Say a command or use Stop to end the session.")
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .addAction(
                Notification.Action.Builder(
                    android.R.drawable.ic_media_pause,
                    "Stop",
                    stopPendingIntent
                ).build()
            )
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.voice_notification_channel),
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun startListening() {
        if (!running) return
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            running = false
            stopSelf()
            return
        }

        try {
            recognizer?.destroy()
            recognizer = if (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) {
                SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            } else {
                SpeechRecognizer.createSpeechRecognizer(this)
            }
            recognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: android.os.Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}

                override fun onError(error: Int) {
                    if (!running) return
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        running = false
                        stopSelf()
                    } else {
                        scheduleListening(1200)
                    }
                }

                override fun onResults(results: android.os.Bundle?) {
                    if (!running) return
                    val transcript = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        ?.firstOrNull()
                        .orEmpty()
                    if (transcript.isBlank()) scheduleListening(500)
                    else handleTranscript(transcript)
                }

                override fun onPartialResults(partialResults: android.os.Bundle?) {}
                override fun onEvent(eventType: Int, params: android.os.Bundle?) {}
            })

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            }
            recognizer?.startListening(intent)
        } catch (_: Exception) {
            scheduleListening(1800)
        }
    }

    private fun handleTranscript(transcript: String) {
        if (LocalCommandProcessor.isStopCommand(transcript)) {
            stopAfterSpeech = true
            speak("Hands-free control is stopping.")
            return
        }

        val localResponse = LocalCommandProcessor.handle(this, transcript, allowUiActions = true)
        if (localResponse != null) {
            speak(localResponse)
            return
        }

        val token = DeviceTokenStore.read(applicationContext)
        val serverUrl = getSharedPreferences("jarvis_companion_settings", MODE_PRIVATE)
            .getString("server_url", null)
        if (token.isNullOrBlank() || serverUrl.isNullOrBlank()) {
            speak("That is a JARVIS chat request. Pair this device with your dashboard to send it to the assistant.")
            return
        }

        networkExecutor.execute {
            try {
                val plan = DeviceConnector.agentPlan(serverUrl, token, transcript)
                mainHandler.post {
                    if (running) speak(AgentPlanRunner.execute(this@VoiceControlService, plan))
                }
            } catch (_: Exception) {
                try {
                    val answer = DeviceConnector.voiceCommand(serverUrl, token, transcript)
                    mainHandler.post {
                        if (running) speak("AI planning is unavailable, so I used the offline assistant. " + answer)
                    }
                } catch (_: Exception) {
                    mainHandler.post {
                        if (running) speak("I could not reach the JARVIS server. Check your connection.")
                    }
                }
            }
        }
    }

    private fun speak(text: String) {
        if (!running) return
        if (!ttsReady || textToSpeech == null) {
            if (stopAfterSpeech) mainHandler.postDelayed({ stopSelf() }, 1200)
            else scheduleListening(900)
            return
        }

        recognizer?.cancel()
        val utteranceId = "jarvis-" + System.currentTimeMillis()
        textToSpeech?.speak(text.take(1200), TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        mainHandler.postDelayed({
            if (!running) return@postDelayed
            if (stopAfterSpeech && textToSpeech?.isSpeaking != true) {
                stopSelf()
            } else if (textToSpeech?.isSpeaking != true) {
                scheduleListening(350)
            }
        }, 1800)
    }

    private fun scheduleListening(delayMs: Long) {
        mainHandler.removeCallbacks(listenRunnable)
        if (running) mainHandler.postDelayed(listenRunnable, delayMs)
    }

    private val listenRunnable = Runnable {
        if (running && textToSpeech?.isSpeaking != true) startListening()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        running = false
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        running = false
        mainHandler.removeCallbacksAndMessages(null)
        recognizer?.cancel()
        recognizer?.destroy()
        textToSpeech?.stop()
        textToSpeech?.shutdown()
        networkExecutor.shutdownNow()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.priyanshuraj.jarviscompanion.voice.START"
        const val ACTION_STOP = "com.priyanshuraj.jarviscompanion.voice.STOP"
        private const val CHANNEL_ID = "jarvis_voice_control"
        private const val NOTIFICATION_ID = 7251
        private const val STOP_REQUEST_CODE = 7252
    }
}
