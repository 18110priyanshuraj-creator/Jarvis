package com.priyanshuraj.jarviscompanion

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.priyanshuraj.jarviscompanion.accessibility.JarvisAccessibilityService
import com.priyanshuraj.jarviscompanion.device.DeviceConnector
import com.priyanshuraj.jarviscompanion.device.DeviceTokenStore
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var serverUrlInput: EditText
    private lateinit var pairingCodeInput: EditText
    private lateinit var statusText: TextView
    private lateinit var voiceButton: Button
    private var speechRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null
    private var pendingVoicePermission = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("jarvis_companion_settings", MODE_PRIVATE)
        serverUrlInput = EditText(this).apply {
            hint = "JARVIS HTTPS server URL"
            setSingleLine(true)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.getString("server_url", ""))
        }
        pairingCodeInput = EditText(this).apply {
            hint = "Six-digit pairing code"
            setSingleLine(true)
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
        }
        statusText = TextView(this).apply {
            textSize = 14f
            text = "Not paired. Generate a pairing code in the JARVIS web dashboard."
            setPadding(0, 16, 0, 16)
        }

        val pairButton = Button(this).apply {
            text = "Pair with JARVIS"
            setOnClickListener { pairDevice() }
        }
        voiceButton = Button(this).apply {
            text = "Speak to JARVIS"
            isEnabled = false
            setOnClickListener { startVoiceRecognition() }
        }
        val accessibilityButton = Button(this).apply {
            text = "Open Accessibility settings"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        }
        val forgetButton = Button(this).apply {
            text = "Forget this device on this tablet"
            setOnClickListener {
                DeviceTokenStore.clear(this@MainActivity)
                refreshStatus("Local device credential removed. Also revoke this device in the JARVIS dashboard.")
            }
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
            addView(TextView(this@MainActivity).apply {
                text = "JARVIS Companion"
                textSize = 26f
            })
            addView(TextView(this@MainActivity).apply {
                text = "Phase 1: secure pairing and voice chat. Android screen actions are not enabled in this build."
                textSize = 14f
                setPadding(0, 8, 0, 16)
            })
            addView(serverUrlInput, matchWidth())
            addView(pairingCodeInput, matchWidth())
            addView(pairButton, matchWidth())
            addView(voiceButton, matchWidth())
            addView(accessibilityButton, matchWidth())
            addView(forgetButton, matchWidth())
            addView(statusText, matchWidth())
        }
        val scroll = ScrollView(this).apply { addView(content) }
        setContentView(scroll)

        textToSpeech = TextToSpeech(this) { result ->
            if (result == TextToSpeech.SUCCESS) {
                textToSpeech?.language = Locale("hi", "IN")
            }
        }
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
        sendHeartbeat()
    }

    private fun matchWidth(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)

    private fun pairDevice() {
        val serverUrl = serverUrlInput.text.toString().trim()
        val code = pairingCodeInput.text.toString().trim()
        if (serverUrl.isBlank() || code.length != 6) {
            refreshStatus("Enter your HTTPS server URL and the six-digit pairing code.")
            return
        }

        executor.execute {
            try {
                val paired = DeviceConnector.pair(serverUrl, code)
                DeviceTokenStore.save(applicationContext, paired.deviceToken)
                getSharedPreferences("jarvis_companion_settings", MODE_PRIVATE)
                    .edit().putString("server_url", serverUrl.trimEnd('/')).apply()
                runOnUiThread {
                    pairingCodeInput.text.clear()
                    refreshStatus("Paired as " + paired.displayName + ". Voice chat is ready.")
                    Toast.makeText(this, "JARVIS device paired.", Toast.LENGTH_SHORT).show()
                }
                sendHeartbeat()
            } catch (error: Exception) {
                runOnUiThread { refreshStatus(error.message ?: "Pairing failed. Check the URL and code.") }
            }
        }
    }

    private fun sendHeartbeat() {
        val token = DeviceTokenStore.read(applicationContext) ?: return
        val serverUrl = getSharedPreferences("jarvis_companion_settings", MODE_PRIVATE)
            .getString("server_url", null) ?: return
        val accessibilityEnabled = isAccessibilityServiceEnabled()
        executor.execute {
            try {
                DeviceConnector.heartbeat(serverUrl, token, accessibilityEnabled)
            } catch (error: Exception) {
                runOnUiThread { statusText.text = "Paired locally. Server heartbeat failed: " + (error.message ?: "connection error") }
            }
        }
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val expected = ComponentName(this, JarvisAccessibilityService::class.java).flattenToString()
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    private fun refreshStatus(message: String? = null) {
        val paired = !DeviceTokenStore.read(applicationContext).isNullOrBlank()
        voiceButton.isEnabled = paired
        val accessibility = if (isAccessibilityServiceEnabled()) "enabled" else "not enabled"
        statusText.text = message ?: if (paired) {
            "Paired. Accessibility observer: " + accessibility + ". Voice commands are sent to the existing offline JARVIS brain."
        } else {
            "Not paired. Generate a one-time code in the JARVIS web dashboard."
        }
    }

    private fun startVoiceRecognition() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingVoicePermission = true
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MICROPHONE)
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            refreshStatus("Speech recognition is not available on this device. You can use the JARVIS web dashboard voice input.")
            return
        }

        speechRecognizer?.destroy()
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)
        speechRecognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { refreshStatus("Listening…") }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { refreshStatus("Processing voice command…") }
            override fun onError(error: Int) { refreshStatus("Speech recognition stopped (code " + error + "). Tap Speak to try again.") }
            override fun onResults(results: Bundle?) {
                val message = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (message.isBlank()) {
                    refreshStatus("No speech was recognized. Please try again.")
                } else {
                    sendVoiceCommand(message)
                }
            }
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN")
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
        speechRecognizer?.startListening(intent)
    }

    private fun sendVoiceCommand(message: String) {
        val token = DeviceTokenStore.read(applicationContext)
        val serverUrl = getSharedPreferences("jarvis_companion_settings", MODE_PRIVATE)
            .getString("server_url", null)
        if (token.isNullOrBlank() || serverUrl.isNullOrBlank()) {
            refreshStatus("Pair this device before sending voice commands.")
            return
        }

        refreshStatus("JARVIS is processing: " + message)
        executor.execute {
            try {
                val answer = DeviceConnector.voiceCommand(serverUrl, token, message)
                runOnUiThread {
                    refreshStatus("JARVIS: " + answer)
                    textToSpeech?.speak(answer, TextToSpeech.QUEUE_FLUSH, null, "jarvis-answer")
                }
            } catch (error: Exception) {
                runOnUiThread { refreshStatus(error.message ?: "Voice request failed.") }
            }
        }
    }

    @Deprecated("Use the Activity Result API in a later UI refactor.")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_MICROPHONE) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            if (granted && pendingVoicePermission) {
                pendingVoicePermission = false
                startVoiceRecognition()
            } else {
                pendingVoicePermission = false
                refreshStatus("Microphone permission was not granted.")
            }
        }
    }

    override fun onDestroy() {
        speechRecognizer?.destroy()
        textToSpeech?.shutdown()
        executor.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val REQUEST_MICROPHONE = 7001
    }
}
