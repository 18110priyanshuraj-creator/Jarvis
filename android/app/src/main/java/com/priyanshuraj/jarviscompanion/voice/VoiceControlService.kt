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
    private var recognitionLanguage = "hi-IN"
    private var voiceStatus = "Microphone session is active. Speak a command or use Stop to end it."

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        textToSpeech = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val hindi = Locale("hi", "IN")
                val hindiStatus = textToSpeech?.isLanguageAvailable(hindi) ?: TextToSpeech.LANG_NOT_SUPPORTED
                val selected = if (hindiStatus >= TextToSpeech.LANG_AVAILABLE) hindi else Locale("en", "IN")
                val selectedStatus = textToSpeech?.isLanguageAvailable(selected) ?: TextToSpeech.LANG_NOT_SUPPORTED
                ttsReady = selectedStatus >= TextToSpeech.LANG_AVAILABLE
                if (ttsReady) {
                    textToSpeech?.language = selected
                    updateVoiceStatus(if (selected == hindi) "Hindi voice output ready. Listening when active." else "Hindi voice data unavailable; using English (India) voice.")
                } else {
                    updateVoiceStatus("No supported text-to-speech voice is installed. Install Hindi or English voice data in Android settings.")
                }
            } else {
                ttsReady = false
                updateVoiceStatus("Android text-to-speech could not initialize (code " + status + ").")
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

    private fun updateVoiceStatus(message: String) {
        voiceStatus = message.take(180)
        if (running) {
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
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
            .setContentText(voiceStatus)
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

        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            updateVoiceStatus("Speech recognition is unavailable. Enable a speech service on this tablet, then restart voice control.")
            running = false
            stopSelf()
            return
        }

        updateVoiceStatus("Listening in " + recognitionLanguage + ". Speak a short command.")
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
                        updateVoiceStatus("Microphone permission is missing. Stop voice control and review Android app permissions.")
                        running = false
                        stopSelf()
                    } else if ((error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
                                error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) && recognitionLanguage == "hi-IN") {
                        recognitionLanguage = "en-IN"
                        updateVoiceStatus("Hindi speech recognition is unavailable. Trying English (India) instead.")
                        scheduleListening(700)
                    } else {
                        val detail = when (error) {
                            SpeechRecognizer.ERROR_NO_MATCH -> "No speech was detected clearly. Try speaking closer to the microphone."
                            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech detected. Listening again."
                            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition needs a working internet connection."
                            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech service is busy. Retrying."
                            SpeechRecognizer.ERROR_SERVER -> "Android speech service returned an error. Retrying."
                            else -> "Speech recognition error code " + error + ". Check the speech service and try again."
                        }
                        updateVoiceStatus(detail)
                        scheduleListening(1600)
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
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, recognitionLanguage)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            }
            recognizer?.startListening(intent)
        } catch (error: Exception) {
            updateVoiceStatus("Could not start speech recognition: " + (error.message ?: "Android speech service error."))
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
                when (plan.optString("mode", "device_action")) {
                    "device_action" -> mainHandler.post {
                        if (running) {
                            AgentPlanRunner.execute(this@VoiceControlService, plan, mainHandler) { result ->
                                if (running) speak(result)
                            }
                        }
                    }
                    "conversation" -> {
                        val answer = DeviceConnector.voiceCommand(serverUrl, token, transcript)
                        mainHandler.post { if (running) speak(answer) }
                    }
                    "clarification" -> {
                        val question = plan.optString("reply").ifBlank {
                            "Please clarify what you want me to do."
                        }
                        mainHandler.post { if (running) speak(question) }
                    }
                    else -> throw IllegalStateException("JARVIS returned an unsupported request mode.")
                }
            } catch (_: Exception) {
                try {
                    val answer = DeviceConnector.voiceCommand(serverUrl, token, transcript)
                    mainHandler.post {
                        if (running) speak(answer)
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
            updateVoiceStatus("Voice output is unavailable. Install Hindi or English text-to-speech data in Android settings.")
            if (stopAfterSpeech) mainHandler.postDelayed({ stopSelf() }, 1200)
            else scheduleListening(900)
            return
        }

        recognizer?.cancel()
        val utteranceId = "jarvis-" + System.currentTimeMillis()
        updateVoiceStatus("Speaking the JARVIS response.")
        val speechResult = textToSpeech?.speak(text.take(1200), TextToSpeech.QUEUE_FLUSH, null, utteranceId)
        if (speechResult == TextToSpeech.ERROR) {
            updateVoiceStatus("Android could not play the response. Check installed Hindi or English voice data.")
            scheduleListening(1200)
            return
        }
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
