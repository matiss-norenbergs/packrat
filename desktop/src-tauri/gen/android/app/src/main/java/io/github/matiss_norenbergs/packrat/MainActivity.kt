package io.github.matiss_norenbergs.packrat

import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var content: View? = null

  // True while the page's video player is fullscreen: the system bars are hidden and the content
  // isn't inset by them (see setImmersive).
  private var immersive = false

  // While immersive, the back gesture leaves fullscreen instead of navigating away. Registered only
  // while immersive (added last, so it runs before Tauri's own back handling).
  private val exitFullscreenOnBack = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      setImmersive(false, exitPageFullscreen = true)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // The frontend does no safe-area handling of its own: instead of drawing under the status bar,
    // navigation bar, display cutout and on-screen keyboard (edge-to-edge is enforced from Android
    // 15), the content view is inset by them. This also keeps a focused input above the keyboard.
    // While immersive (fullscreen video) the bars are hidden and the padding is dropped, so the
    // video fills the screen; a cutout still insets it, the keyboard is never open then.
    val content = findViewById<View>(android.R.id.content)
    this.content = content
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val types = if (immersive) {
        WindowInsetsCompat.Type.displayCutout()
      } else {
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      }
      val bars = insets.getInsets(types)
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  // Called by wry before the WebView loads its first page, so the bridge exists from the start.
  // The WebView only ever loads the app's bundled frontend (http://tauri.localhost); the bridge has
  // a single method that toggles the system bars and nothing else, and it ignores calls while the
  // WebView is on any other origin.
  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(ImmersiveBridge(), "PackratAndroid")
  }

  private inner class ImmersiveBridge {
    // Runs on a WebView background thread: hop to the UI thread for the window and the URL check.
    @JavascriptInterface
    fun setImmersive(enabled: Boolean) {
      runOnUiThread {
        if (isAppPage()) setImmersive(enabled, exitPageFullscreen = false)
      }
    }
  }

  private fun isAppPage(): Boolean {
    val url = webView?.url ?: return false
    return url.startsWith("http://tauri.localhost/") || url == "http://tauri.localhost" ||
      url.startsWith("https://tauri.localhost/") || url == "https://tauri.localhost"
  }

  private fun setImmersive(enabled: Boolean, exitPageFullscreen: Boolean) {
    if (enabled == immersive) return
    immersive = enabled
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    if (enabled) {
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(WindowInsetsCompat.Type.systemBars())
      exitFullscreenOnBack.remove()
      onBackPressedDispatcher.addCallback(this, exitFullscreenOnBack)
    } else {
      controller.show(WindowInsetsCompat.Type.systemBars())
      exitFullscreenOnBack.remove()
      // The page is told too, so the player leaves fullscreen when the bars come back on their own
      // (back gesture, app going to the background).
      if (exitPageFullscreen) {
        webView?.evaluateJavascript("if (document.fullscreenElement) document.exitFullscreen().catch(() => {})", null)
      }
    }
    content?.let { ViewCompat.requestApplyInsets(it) }
  }

  // Backgrounding the app always restores the bars (the page also leaves fullscreen).
  override fun onStop() {
    setImmersive(false, exitPageFullscreen = true)
    super.onStop()
  }
}
