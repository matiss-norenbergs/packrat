package io.github.matiss_norenbergs.packrat

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // SPIKE: the shared frontend has no safe-area handling, so instead of drawing under the
    // status bar, navigation bar, display cutout and on-screen keyboard (edge-to-edge is enforced
    // from Android 15), the content view is inset by them. This also keeps a focused input above
    // the keyboard. To be replaced by CSS safe-area insets when the mobile layout is built.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
