package com.priyanshuraj.jarviscompanion

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
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
import com.priyanshuraj.jarviscompanion.voice.LocalCommandProcessor
import com.priyanshuraj.jarviscompanion.voice.VoiceControlService
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var serverUrlInput: EditText
    private lateinit var pairingCodeInput: EditText
    private lateinit var statusText: TextView
    private lateinit var permissionChecklistText: TextView
    private lateinit var voiceButton: Button
    private var speechRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null
    private var pendingVoicePermission = false
    private var pendingHandsFreeStart = false

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

        permissionChecklistText = TextView(this).apply {
            textSize = 13f
            setPadding(0, 8, 0, 12)
        }

        val pairButton = Button(this).apply {
            text = "Pair with JARVIS"
            setOnClickListener { pairDevice() }
        }
        voiceButton = Button(this).apply {
            text = "Speak once"
            isEnabled = true
            setOnClickListener { startVoiceRecognition() }
        }
        val handsFreeButton = Button(this).apply {
            text = "Start hands-free control"
            setOnClickListener { startHandsFreeControl() }
        }
        val stopHandsFreeButton = Button(this).apply {
            text = "Stop hands-free control"
            setOnClickListener { stopHandsFreeControl() }
        }
        val accessibilityButton = Button(this).apply {
            text = "Review screen-access permission"
            setOnClickListener { showAccessibilityDisclosure() }
        }

        val checkPermissionsButton = Button(this).apply {
            text = "Refresh permission checklist"
            setOnClickListener { refreshPermissionChecklist() }
        }
        val appSettingsButton = Button(this).apply {
            text = "Open JARVIS app permissions"
            setOnClickListener { openAppSettings() }
        }
        val notificationSettingsButton = Button(this).apply {
            text = "Open notification settings"
            setOnClickListener { openNotificationSettings() }
        }
        val requestNotificationsButton = Button(this).apply {
            text = "Request notification permission"
            setOnClickListener { requestNotificationPermission() }
        }
        val apkInstallHelpButton = Button(this).apply {
            text = "APK installation help"
            setOnClickListener { showApkInstallHelp() }
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
                text = "Phase 2: user-started hands-free voice, app launch, screen observation, safe tap, text entry and scrolling."
                textSize = 14f
                setPadding(0, 8, 0, 8)
            })
            addView(TextView(this@MainActivity).apply {
                text = "Screen labels are read locally only when requested. This phase does not upload screen content and will not activate send, delete, payment, password or verification controls."
                textSize = 12f
                setPadding(0, 0, 0, 16)
            })
            addView(serverUrlInput, matchWidth())
            addView(pairingCodeInput, matchWidth())
            addView(pairButton, matchWidth())
            addView(voiceButton, matchWidth())
            addView(handsFreeButton, matchWidth())
            addView(stopHandsFreeButton, matchWidth())
            addView(accessibilityButton, matchWidth())
            addView(TextView(this@MainActivity).apply {
                text = "SETUP & PERMISSIONS"
                textSize = 18f
                setPadding(0, 24, 0, 8)
            })
            addView(permissionChecklistText, matchWidth())
            addView(checkPermissionsButton, matchWidth())
            addView(appSettingsButton, matchWidth())
            addView(notificationSettingsButton, matchWidth())
            addView(requestNotificationsButton, matchWidth())
            addView(apkInstallHelpButton, matchWidth())
            addView(forgetButton, matchWidth())
            addView(statusText, matchWidth())
        }
        setContentView(ScrollView(this).apply { addView(content) })

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
        refreshPermissionChecklist()
        sendHeartbeat()
    }

    private fun matchWidth(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)


    private fun refreshPermissionChecklist() {
        permissionChecklistText.text = PermissionSetup.render(this)
    }

    private fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = android.net.Uri.parse("package:" + packageName)
        }
        startActivity(intent)
    }

    private fun openNotificationSettings() {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
            putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        }
        try {
            startActivity(intent)
        } catch (_: Exception) {
            openAppSettings()
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        } else {
            openNotificationSettings()
        }
    }

    private fun showApkInstallHelp() {
        AlertDialog.Builder(this)
            .setTitle("APK installation on Android")
            .setMessage(
                "JARVIS does not need permission to install other apps and does not access your Downloads folder. " +
                    "When you manually install this APK, Android may ask whether the app you used to open it " +
                    "(such as Chrome or My Files) can install unknown apps. Review that source app in Settings, " +
                    "allow it only if you trust the APK source, install the Companion, then switch the setting off again. " +
                    "Do not enable broad storage access or overlay access for JARVIS; this app does not need them."
            )
            .setPositiveButton("Open app settings") { _, _ -> openAppSettings() }
            .setNegativeButton("Close", null)
            .show()
    }

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

    private fun refreshStatus(message: String? = null) {
        val paired = !DeviceTokenStore.read(applicationContext).isNullOrBlank()
        voiceButton.isEnabled = true
        val accessibility = if (PermissionSetup.isAccessibilityEnabled(this)) "enabled" else "not enabled"
        refreshPermissionChecklist()
        statusText.text = message ?: buildString {
            append(if (paired) "Paired with JARVIS server." else "Not paired with the JARVIS server.")
            append(" Screen access: ")
            append(accessibility)
            append(". Use Start hands-free control to keep voice commands available while another app is open.")
        }
    }

    private fun showAccessibilityDisclosure() {
        AlertDialog.Builder(this)
            .setTitle("JARVIS screen access")
            .setMessage(
                "Android Accessibility lets JARVIS inspect visible app labels and perform the specific action you speak. " +
                    "Screen content is processed locally on this tablet and is not sent to the JARVIS server in this phase. " +
                    "Password and verification fields, plus send, delete, payment and confirmation controls are blocked. " +
                    "You can disable this service anytime in Android Settings."
            )
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Open Android settings") { _, _ ->
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
            .show()
    }

    private fun startHandsFreeControl() {
        if (!PermissionSetup.isAccessibilityEnabled(this)) {
            showAccessibilityDisclosure()
            return
        }

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingHandsFreeStart = true
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_HANDS_FREE_PERMISSIONS)
            return
        }

        try {
            val intent = Intent(this, VoiceControlService::class.java).setAction(VoiceControlService.ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
            refreshStatus("Hands-free session started. A persistent notification shows that the microphone is active. Say 'stop listening' or use Stop in the notification.")
        } catch (error: Exception) {
            refreshStatus("Could not start hands-free control: " + (error.message ?: "Android blocked the service."))
        }
    }

    private fun stopHandsFreeControl() {
        stopService(Intent(this, VoiceControlService::class.java))
        refreshStatus("Hands-free control stopped.")
    }

    private fun startVoiceRecognition() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingVoicePermission = true
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_MICROPHONE)
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            refreshStatus("Speech recognition is not available on this device.")
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
            override fun onError(error: Int) { refreshStatus("Speech recognition stopped (code " + error + "). Tap Speak once to try again.") }
            override fun onResults(results: Bundle?) {
                val message = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (message.isBlank()) {
                    refreshStatus("No speech was recognized. Please try again.")
                } else {
                    val localResponse = LocalCommandProcessor.handle(this@MainActivity, message, allowUiActions = false)
                    if (localResponse != null) {
                        refreshStatus(localResponse)
                        textToSpeech?.speak(localResponse, TextToSpeech.QUEUE_FLUSH, null, "jarvis-local-answer")
                    } else {
                        sendVoiceCommand(message)
                    }
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
            refreshStatus("Pair this device with your dashboard before sending general chat commands. Local app opening still works.")
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
        } else if (requestCode == REQUEST_HANDS_FREE_PERMISSIONS) {
            val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
            pendingHandsFreeStart = false
            if (granted) startHandsFreeControl()
            else refreshStatus("Microphone permission is required for voice control.")
        } else if (requestCode == REQUEST_NOTIFICATIONS) {
            refreshPermissionChecklist()
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                refreshStatus("Notification permission is enabled.")
            } else {
                refreshStatus("Notifications remain optional. Voice control can still run with Android's foreground-service status.")
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
        private const val REQUEST_HANDS_FREE_PERMISSIONS = 7002
        private const val REQUEST_NOTIFICATIONS = 7003
    }
}
