package com.priyanshuraj.jarviscompanion

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.view.inputmethod.EditorInfo
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
import android.net.Uri
import android.net.http.SslError
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.JsResult
import android.webkit.JsPromptResult
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.priyanshuraj.jarviscompanion.accessibility.JarvisAccessibilityService
import com.priyanshuraj.jarviscompanion.LocalActivityLog
import com.priyanshuraj.jarviscompanion.device.DeviceConnector
import com.priyanshuraj.jarviscompanion.device.DeviceTokenStore
import com.priyanshuraj.jarviscompanion.voice.LocalCommandProcessor
import com.priyanshuraj.jarviscompanion.voice.VoiceControlService
import com.priyanshuraj.jarviscompanion.voice.VoiceOutput
import java.util.Locale
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var serverUrlInput: EditText
    private lateinit var pairingCodeInput: EditText
    private lateinit var statusText: TextView
    private lateinit var permissionChecklistText: TextView
    private lateinit var activityLogText: TextView
    private lateinit var voiceButton: Button
    private lateinit var setupRootView: View
    private var homeScreen: View? = null
    private var homeStatusText: TextView? = null
    private var homeMessageInput: EditText? = null
    private var orbitalOrbView: OrbitalOrbView? = null
    private var dashboardScreen: View? = null
    private var dashboardWebView: WebView? = null
    private var dashboardStatusText: TextView? = null
    private var dashboardBaseUrl: String? = null
    private var showingDashboard = false
    private var showingSetup = false
    private var speechRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null
    private var recognitionLanguage = "hi-IN"
    private var pendingVoicePermission = false
    private var pendingHandsFreeStart = false
    private var pendingVoiceOnlyStart = false

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
        activityLogText = TextView(this).apply {
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

        val refreshActivityButton = Button(this).apply {
            text = "Refresh activity history"
            setOnClickListener { refreshActivityLog() }
        }
        val clearActivityButton = Button(this).apply {
            text = "Clear activity history"
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Clear local activity history?")
                    .setMessage("This removes activity entries stored on this tablet. It does not affect pairing or the dashboard.")
                    .setNegativeButton("Keep", null)
                    .setPositiveButton("Clear") { _, _ ->
                        LocalActivityLog.clear(this@MainActivity)
                        refreshActivityLog()
                    }
                    .show()
            }
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
            addView(TextView(this@MainActivity).apply {
                text = "JARVIS setup and controls"
                textSize = 26f
            })
            addView(TextView(this@MainActivity).apply {
                text = "The central orb is the home screen. This page keeps the original pairing, voice, permissions and activity tools."
                textSize = 14f
                setPadding(0, 8, 0, 16)
            })
            addView(serverUrlInput, matchWidth())
            addView(pairingCodeInput, matchWidth())
            addView(pairButton, matchWidth())
            addView(voiceButton, matchWidth())
            addView(handsFreeButton, matchWidth())
            addView(stopHandsFreeButton, matchWidth())
            addView(accessibilityButton, matchWidth())
            addView(TextView(this@MainActivity).apply {
                text = "PERMISSIONS"
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
            addView(TextView(this@MainActivity).apply {
                text = "RECENT ACTIVITY"
                textSize = 18f
                setPadding(0, 24, 0, 8)
            })
            addView(TextView(this@MainActivity).apply {
                text = "Stored only on this tablet: timestamps, event names and generic action categories. Voice transcripts, typed field contents and screen text are not saved."
                textSize = 12f
                setPadding(0, 0, 0, 8)
            })
            addView(activityLogText, matchWidth())
            addView(refreshActivityButton, matchWidth())
            addView(clearActivityButton, matchWidth())
            addView(statusText, matchWidth())
        }
        setupRootView = ScrollView(this).apply {
            isFillViewport = true
            addView(content)
        }
        showHomeScreen()
        if (savedInstanceState?.getBoolean(STATE_SHOWING_DASHBOARD, false) == true) {
            showDashboardScreen(savedInstanceState.getBundle(STATE_DASHBOARD_WEBVIEW))
        }

        textToSpeech = TextToSpeech(this) { result ->
            if (result == TextToSpeech.SUCCESS) {
                val selection = textToSpeech?.let { VoiceOutput.configure(it, recognitionLanguage) }
                if (selection != null) refreshStatus(selection.message)
                else refreshStatus("Android text-to-speech could not initialize.")
            } else {
                refreshStatus("Android text-to-speech could not initialize (code " + result + ").")
            }
        }
        refreshStatus()
    }


    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun homeButton(label: String): Button = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        setTextColor(Color.WHITE)
        minHeight = dp(48)
        setPadding(dp(14), dp(8), dp(14), dp(8))
        background = GradientDrawable().apply {
            setColor(Color.rgb(16, 45, 67))
            cornerRadius = dp(24).toFloat()
            setStroke(dp(1), Color.rgb(39, 143, 178))
        }
    }

    private fun showHomeScreen() {
        dashboardWebView?.onPause()
        val screen = homeScreen ?: createHomeScreen().also { homeScreen = it }
        showingSetup = false
        showingDashboard = false
        setContentView(screen)
        refreshStatus()
    }

    private fun showSetupScreen() {
        dashboardWebView?.onPause()
        showingSetup = true
        showingDashboard = false
        setContentView(setupRootView)
        refreshStatus()
        refreshPermissionChecklist()
        refreshActivityLog()
    }

    private fun showDashboardScreen(restoreState: Bundle? = null) {
        val configuredUrl = DashboardUrlPolicy.normalizeBaseUrl(
            getSharedPreferences("jarvis_companion_settings", MODE_PRIVATE)
                .getString("server_url", null)
        )
        if (configuredUrl == null) {
            AlertDialog.Builder(this)
                .setTitle("Workspace not configured")
                .setMessage("Open Setup and pair this tablet with your JARVIS HTTPS server first. The Workspace screen uses that saved server address.")
                .setPositiveButton("Open Setup") { _, _ -> showSetupScreen() }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }

        dashboardBaseUrl = configuredUrl
        val screen = dashboardScreen ?: createDashboardScreen().also { dashboardScreen = it }
        showingSetup = false
        showingDashboard = true
        setContentView(screen)

        var restored = false
        if (restoreState != null) {
            restored = dashboardWebView?.restoreState(restoreState) != null
            val restoredUrl = dashboardWebView?.url
            if (restored && !DashboardUrlPolicy.allowsInAppNavigation(restoredUrl, configuredUrl)) {
                dashboardWebView?.clearHistory()
                restored = false
            }
        }

        val currentUrl = dashboardWebView?.url
        if (!restored && (
                currentUrl.isNullOrBlank() ||
                    currentUrl == "about:blank" ||
                    !DashboardUrlPolicy.allowsInAppNavigation(currentUrl, configuredUrl)
            )
        ) {
            dashboardStatusText?.text = "Opening your private JARVIS workspace…"
            dashboardWebView?.loadUrl(configuredUrl)
        }
    }

    private fun createDashboardScreen(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(4, 13, 29))
        }

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(8))
        }
        val home = homeButton("Home").apply {
            contentDescription = "Return to the JARVIS orb home screen"
            setOnClickListener { showHomeScreen() }
        }
        val title = TextView(this).apply {
            text = "JARVIS WORKSPACE"
            textSize = 14f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            letterSpacing = 0.06f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(222, 248, 255))
        }
        val setup = homeButton("Setup").apply {
            contentDescription = "Open JARVIS pairing and permission setup"
            setOnClickListener { showSetupScreen() }
        }
        val reload = homeButton("Reload").apply {
            contentDescription = "Reload the JARVIS workspace"
            setOnClickListener { dashboardWebView?.reload() }
        }
        toolbar.addView(home, LinearLayout.LayoutParams(dp(76), dp(44)))
        toolbar.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        toolbar.addView(setup, LinearLayout.LayoutParams(dp(82), dp(44)).apply {
            marginEnd = dp(8)
        })
        toolbar.addView(reload, LinearLayout.LayoutParams(dp(88), dp(44)))

        dashboardStatusText = TextView(this).apply {
            text = "Your private workspace opens here. Sign in with your existing JARVIS workspace password when prompted."
            textSize = 12f
            setTextColor(Color.rgb(145, 177, 194))
            setPadding(dp(16), dp(4), dp(16), dp(8))
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }

        val webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(4, 13, 29))
            isFocusable = true
            isFocusableInTouchMode = true
            scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                safeBrowsingEnabled = true
                loadsImagesAutomatically = true
            }
        }
        dashboardWebView = webView
        webView.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                val callback = result ?: return true
                if (isFinishing || !DashboardUrlPolicy.isWorkspaceOrigin(url, dashboardBaseUrl)) {
                    callback.cancel()
                    return true
                }
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("JARVIS workspace")
                    .setMessage(message.orEmpty().take(2000))
                    .setPositiveButton("OK") { _, _ -> callback.confirm() }
                    .setOnCancelListener { callback.cancel() }
                    .show()
                return true
            }

            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                val callback = result ?: return true
                if (isFinishing || !DashboardUrlPolicy.isWorkspaceOrigin(url, dashboardBaseUrl)) {
                    callback.cancel()
                    return true
                }
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Confirm in JARVIS")
                    .setMessage(message.orEmpty().take(2000))
                    .setNegativeButton("Cancel") { _, _ -> callback.cancel() }
                    .setPositiveButton("Continue") { _, _ -> callback.confirm() }
                    .setOnCancelListener { callback.cancel() }
                    .show()
                return true
            }

            override fun onJsPrompt(
                view: WebView?,
                url: String?,
                message: String?,
                defaultValue: String?,
                result: JsPromptResult?
            ): Boolean {
                val callback = result ?: return true
                if (isFinishing || !DashboardUrlPolicy.isWorkspaceOrigin(url, dashboardBaseUrl)) {
                    callback.cancel()
                    return true
                }
                val response = EditText(this@MainActivity).apply {
                    setSingleLine(true)
                    setText(defaultValue.orEmpty())
                    setSelection(text.length)
                }
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("JARVIS confirmation")
                    .setMessage(message.orEmpty().take(2000))
                    .setView(response)
                    .setNegativeButton("Cancel") { _, _ -> callback.cancel() }
                    .setPositiveButton("Submit") { _, _ -> callback.confirm(response.text.toString()) }
                    .setOnCancelListener { callback.cancel() }
                    .show()
                return true
            }
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest
            ): Boolean = routeDashboardNavigation(request.url.toString())

            @Suppress("DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String): Boolean =
                routeDashboardNavigation(url)

            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                dashboardStatusText?.text = "Connecting to your private JARVIS workspace…"
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                dashboardStatusText?.text = "Workspace loaded. Sign in if the private login screen appears."
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    dashboardStatusText?.text = "The workspace could not be loaded. Check the server connection and try Reload."
                }
            }

            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                handler?.cancel()
                dashboardStatusText?.text = "Secure connection verification failed. JARVIS blocked this page."
            }

            override fun onRenderProcessGone(
                view: WebView?,
                detail: RenderProcessGoneDetail?
            ): Boolean {
                if (view == null) return true
                val parent = view.parent as? ViewGroup
                parent?.removeView(view)
                view.destroy()
                if (dashboardWebView === view) {
                    dashboardWebView = null
                    dashboardScreen = null
                    if (showingDashboard) {
                        dashboardStatusText = null
                        showDashboardScreen()
                        dashboardStatusText?.text = "The workspace renderer restarted. JARVIS reopened the dashboard."
                    }
                }
                return true
            }
        }

        root.addView(toolbar, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        root.addView(dashboardStatusText, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        root.addView(webView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))
        return root
    }

    private fun routeDashboardNavigation(rawUrl: String): Boolean {
        if (DashboardUrlPolicy.allowsInAppNavigation(rawUrl, dashboardBaseUrl)) {
            return false
        }
        if (DashboardUrlPolicy.isSafeExternalHttpsUrl(rawUrl)) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl)))
            } catch (_: Exception) {
                Toast.makeText(this, "No browser is available to open this link.", Toast.LENGTH_SHORT).show()
            }
        }
        return true
    }

    private fun createHomeScreen(): View {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.rgb(4, 13, 29), Color.rgb(2, 6, 17), Color.rgb(3, 18, 31))
            )
        }

        val screenWidthDp = resources.configuration.screenWidthDp
        val horizontalPadding = HomeLayoutPolicy.horizontalPaddingDp(screenWidthDp)
        val orbSizeDp = HomeLayoutPolicy.orbSizeDp(screenWidthDp)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(horizontalPadding), dp(24), dp(horizontalPadding), dp(24))
            minimumHeight = resources.displayMetrics.heightPixels
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val brand = TextView(this).apply {
            text = "J A R V I S"
            textSize = 24f
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            letterSpacing = 0.08f
            setTextColor(Color.rgb(222, 248, 255))
        }
        val workspaceButton = homeButton("Workspace")
        workspaceButton.contentDescription = "Open the private JARVIS workspace"
        workspaceButton.setOnClickListener { showDashboardScreen() }
        val setupButton = homeButton("Setup")
        setupButton.contentDescription = "Open pairing, voice and permission setup"
        setupButton.setOnClickListener { showSetupScreen() }
        header.addView(brand, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(workspaceButton, LinearLayout.LayoutParams(dp(108), dp(44)).apply {
            marginEnd = dp(8)
        })
        header.addView(setupButton, LinearLayout.LayoutParams(dp(84), dp(44)))

        val subtitle = TextView(this).apply {
            text = "YOUR PERSONAL ASSISTANT"
            textSize = 11f
            letterSpacing = 0.18f
            setTextColor(Color.rgb(112, 177, 198))
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(2))
        }

        orbitalOrbView = OrbitalOrbView(this).apply {
            contentDescription = "JARVIS animated orb. Tap to start voice recognition."
            isFocusable = true
            isClickable = true
            setOnClickListener { startVoiceRecognition() }
        }
        val orbParams = LinearLayout.LayoutParams(dp(orbSizeDp), dp(orbSizeDp)).apply {
            topMargin = dp(12)
            bottomMargin = dp(6)
        }

        val prompt = TextView(this).apply {
            text = "TAP THE ORB TO SPEAK"
            textSize = 12f
            letterSpacing = 0.16f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(121, 205, 224))
            setPadding(0, dp(4), 0, dp(10))
        }

        homeStatusText = TextView(this).apply {
            text = "Ready. Tap the orb or type a message."
            textSize = 14f
            gravity = Gravity.CENTER
            maxLines = 3
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            setTextColor(Color.rgb(213, 230, 239))
            setPadding(dp(18), dp(8), dp(18), dp(12))
        }

        homeMessageInput = EditText(this).apply {
            hint = "Ask JARVIS something…"
            setSingleLine(true)
            imeOptions = EditorInfo.IME_ACTION_SEND
            setOnEditorActionListener { _, actionId, _ ->
                if (actionId == EditorInfo.IME_ACTION_SEND) {
                    submitHomeMessage()
                    true
                } else {
                    false
                }
            }
            textSize = 15f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.rgb(132, 157, 172))
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setPadding(dp(16), dp(8), dp(16), dp(8))
            background = GradientDrawable().apply {
                setColor(Color.argb(190, 9, 25, 39))
                cornerRadius = dp(18).toFloat()
                setStroke(dp(1), Color.rgb(35, 88, 110))
            }
        }
        val sendButton = homeButton("Send")
        sendButton.contentDescription = "Send the typed message to JARVIS"
        sendButton.setOnClickListener { submitHomeMessage() }
        val messageRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(homeMessageInput, LinearLayout.LayoutParams(0, dp(54), 1f).apply {
                marginEnd = dp(8)
            })
            addView(sendButton, LinearLayout.LayoutParams(dp(82), dp(54)))
        }

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, dp(4))
        }
        val speakButton = homeButton("Speak")
        speakButton.contentDescription = "Start one-time voice recognition"
        speakButton.setOnClickListener { startVoiceRecognition() }
        val handsFreeButton = homeButton("Hands-free")
        handsFreeButton.contentDescription = "Start user-controlled hands-free voice mode"
        handsFreeButton.setOnClickListener { startHandsFreeControl() }
        controls.addView(speakButton, LinearLayout.LayoutParams(0, dp(50), 1f).apply {
            marginEnd = dp(6)
        })
        controls.addView(handsFreeButton, LinearLayout.LayoutParams(0, dp(50), 1f).apply {
            marginStart = dp(6)
        })

        val footer = TextView(this).apply {
            text = "Microphone use starts only when you choose Speak or Hands-free. Setup keeps the existing pairing and permission controls."
            textSize = 11f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(104, 137, 153))
            setPadding(dp(12), dp(14), dp(12), dp(8))
        }

        content.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        content.addView(subtitle, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        content.addView(orbitalOrbView, orbParams)
        content.addView(prompt, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        content.addView(homeStatusText, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        content.addView(messageRow, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        content.addView(controls, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        content.addView(footer, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val contentFrame = FrameLayout(this).apply {
            val contentWidth = HomeLayoutPolicy.contentMaxWidthDp(screenWidthDp)
                ?.let(::dp)
                ?: ViewGroup.LayoutParams.MATCH_PARENT
            addView(
                content,
                FrameLayout.LayoutParams(
                    contentWidth,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.TOP or Gravity.CENTER_HORIZONTAL
                )
            )
        }
        scroll.addView(contentFrame)
        return scroll
    }

    private fun submitHomeMessage() {
        val message = homeMessageInput?.text?.toString()?.trim().orEmpty()
        if (message.isBlank()) {
            refreshStatus("Type a message first.")
            return
        }
        homeMessageInput?.text?.clear()
        val localResponse = LocalCommandProcessor.handle(this, message, allowUiActions = false)
        if (localResponse != null) {
            refreshStatus(localResponse)
            speakReply(localResponse)
        } else {
            sendVoiceCommand(message)
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (showingDashboard) {
            val webView = dashboardWebView
            if (webView?.canGoBack() == true) {
                webView.goBack()
            } else {
                showHomeScreen()
            }
        } else if (showingSetup) {
            showHomeScreen()
        } else {
            super.onBackPressed()
        }
    }

    override fun onResume() {
        super.onResume()
        dashboardWebView?.onResume()
        refreshStatus()
        refreshPermissionChecklist()
        refreshActivityLog()
        sendHeartbeat()
    }

    override fun onPause() {
        dashboardWebView?.onPause()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean(STATE_SHOWING_DASHBOARD, showingDashboard)
        if (showingDashboard) {
            val webViewState = Bundle()
            dashboardWebView?.saveState(webViewState)
            outState.putBundle(STATE_DASHBOARD_WEBVIEW, webViewState)
            CookieManager.getInstance().flush()
        }
        super.onSaveInstanceState(outState)
    }

    private fun matchWidth(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)


    private fun refreshPermissionChecklist() {
        permissionChecklistText.text = PermissionSetup.render(this)
    }

    private fun refreshActivityLog() {
        activityLogText.text = LocalActivityLog.render(this)
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
        val accessibilityEnabled = PermissionSetup.isAccessibilityEnabled(this)
        executor.execute {
            try {
                DeviceConnector.heartbeat(serverUrl, token, accessibilityEnabled)
            } catch (error: Exception) {
                runOnUiThread { refreshStatus("Paired locally. Server heartbeat failed: " + (error.message ?: "connection error")) }
            }
        }
    }

    private fun refreshStatus(message: String? = null) {
        val paired = !DeviceTokenStore.read(applicationContext).isNullOrBlank()
        voiceButton.isEnabled = true
        val accessibility = if (PermissionSetup.isAccessibilityEnabled(this)) "enabled" else "not enabled"
        refreshPermissionChecklist()
        val currentStatus = message ?: buildString {
            append(if (paired) "Paired with JARVIS server." else "Not paired with the JARVIS server.")
            append(" Screen access: ")
            append(accessibility)
            append(". Use Setup to review pairing and permissions.")
        }
        statusText.text = currentStatus
        homeStatusText?.text = currentStatus
        orbitalOrbView?.setListening(
            currentStatus.contains("listening", ignoreCase = true) ||
                currentStatus.contains("processing", ignoreCase = true) ||
                currentStatus.contains("hands-free session started", ignoreCase = true) ||
                currentStatus.contains("microphone is active", ignoreCase = true)
        )
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
            .setNeutralButton("Continue voice-only") { _, _ ->
                startHandsFreeControl(allowVoiceOnly = true)
            }
            .setPositiveButton("Open Android settings") { _, _ ->
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
            .show()
    }

    private fun startHandsFreeControl(allowVoiceOnly: Boolean = false) {
        textToSpeech?.stop()
        if (!PermissionSetup.isAccessibilityEnabled(this) && !allowVoiceOnly) {
            showAccessibilityDisclosure()
            return
        }

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingHandsFreeStart = true
            pendingVoiceOnlyStart = allowVoiceOnly
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
        textToSpeech?.stop()
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
            override fun onError(error: Int) {
                if ((error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
                     error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) && recognitionLanguage == "hi-IN") {
                    recognitionLanguage = "en-IN"
                    refreshStatus("Hindi speech recognition is unavailable. Retrying once in English (India)…")
                    val retryIntent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, recognitionLanguage)
                        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                    }
                    speechRecognizer?.startListening(retryIntent)
                } else {
                    val detail = when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH -> "No speech was detected clearly. Try speaking closer to the microphone."
                        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech detected. Tap Speak once and try again."
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition needs a working internet connection."
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is missing. Review JARVIS app permissions."
                        else -> "Speech recognition stopped (code " + error + "). Check the Android speech service."
                    }
                    refreshStatus(detail)
                }
            }
            override fun onResults(results: Bundle?) {
                val message = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (message.isBlank()) {
                    refreshStatus("No speech was recognized. Please try again.")
                } else {
                    val localResponse = LocalCommandProcessor.handle(this@MainActivity, message, allowUiActions = false)
                    if (localResponse != null) {
                        refreshStatus(localResponse)
                        speakReply(localResponse)
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
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, recognitionLanguage)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
        speechRecognizer?.startListening(intent)
    }

    private fun speakReply(text: String) {
        val engine = textToSpeech ?: run {
            refreshStatus("Android text-to-speech is not ready yet.")
            return
        }
        val replyLanguage = if (text.any { it.code in 0x0900..0x097F }) "hi-IN" else "en-IN"
        val selection = VoiceOutput.configure(engine, replyLanguage)
        if (!selection.message.isBlank()) refreshStatus(selection.message)
        try {
            VoiceOutput.speakChunks(engine, text, "jarvis-" + System.currentTimeMillis())
        } catch (error: Exception) {
            refreshStatus(error.message ?: "Android could not speak the full reply.")
        }
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
                    speakReply(answer)
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
            val voiceOnly = pendingVoiceOnlyStart
            pendingHandsFreeStart = false
            pendingVoiceOnlyStart = false
            if (granted) startHandsFreeControl(allowVoiceOnly = voiceOnly)
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
        textToSpeech?.stop()
        textToSpeech?.shutdown()
        dashboardWebView?.apply {
            stopLoading()
            webViewClient = WebViewClient()
            removeAllViews()
            destroy()
        }
        dashboardWebView = null
        executor.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val STATE_SHOWING_DASHBOARD = "jarvis.showing_dashboard"
        private const val STATE_DASHBOARD_WEBVIEW = "jarvis.dashboard_webview_state"
        private const val REQUEST_MICROPHONE = 7001
        private const val REQUEST_HANDS_FREE_PERMISSIONS = 7002
        private const val REQUEST_NOTIFICATIONS = 7003
    }
}
