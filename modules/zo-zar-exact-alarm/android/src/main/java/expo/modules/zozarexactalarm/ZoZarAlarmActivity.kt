package expo.modules.zozarexactalarm

import android.app.Activity
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Space
import android.widget.TextView
import org.json.JSONObject
import kotlin.math.abs

class ZoZarAlarmActivity : Activity() {
  private lateinit var alarm: JSONObject
  private lateinit var root: LinearLayout
  private var step = 0
  private var answers = emptyList<String>()
  private var prompts = emptyList<String>()
  private var input: EditText? = null

  // Hearth dark palette. The ring screen is always dark: it is shown at night, over the lock screen.
  private val colorBackground = Color.rgb(28, 28, 25)      // #1C1C19
  private val colorSurface = Color.rgb(41, 41, 35)         // #292923
  private val colorText = Color.rgb(243, 237, 223)         // #F3EDDF
  private val colorTextSecondary = Color.rgb(183, 178, 164) // #B7B2A4
  private val colorSubtle = Color.rgb(162, 157, 144)       // #A29D90, theme dark `subtle`, for hint text
  private val colorFill = Color.rgb(231, 187, 114)         // #E7BB72
  private val colorOnFill = Color.rgb(41, 35, 25)          // #292319
  private val colorError = Color.rgb(238, 154, 134)        // #EE9A86

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) { setShowWhenLocked(true); setTurnScreenOn(true) }
    else window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD)
    val alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: run { finish(); return }
    alarm = AlarmStore.get(this, alarmId) ?: run { finish(); return }
    showRing()
  }

  override fun onBackPressed() { /* The alarm cannot be dismissed without a choice. */ }

  private fun base(): LinearLayout {
    root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(28), dp(52), dp(28), dp(30))
      setBackgroundColor(colorBackground)
    }
    window.decorView.setBackgroundColor(colorBackground)
    setContentView(root)
    root.addView(label("ZO-ZAR", 14f, colorTextSecondary).apply { letterSpacing = .08f })
    root.addView(Space(this).apply { minimumHeight = dp(42) })
    return root
  }

  private fun showRing() {
    base()
    // Follow the phone's own 12/24-hour setting, as every React screen does.
    val pattern = if (android.text.format.DateFormat.is24HourFormat(this)) "HH:mm" else "h:mm a"
    val time = java.text.SimpleDateFormat(pattern, java.util.Locale.getDefault()).format(java.util.Date())
    root.addView(label(time, 58f, colorText).apply { setTypeface(typeface, android.graphics.Typeface.BOLD) })
    root.addView(label(alarm.optString("title", "It’s time to wake up."), 24f, colorText).apply { gravity = Gravity.CENTER; setPadding(0, dp(12), 0, dp(8)) })
    root.addView(label("Take it one step at a time.", 16f, colorTextSecondary).apply { gravity = Gravity.CENTER })
    root.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 0, 1f) })
    root.addView(button("I’m awake", true) { beginChallenge() })
    if (alarm.optInt("snoozeCount", 0) < 1) root.addView(button("Snooze 5 minutes", false) { AlarmScheduler.snooze(this, alarm.getString("alarmId"), 5); finish() })
    else root.addView(label("You’ve already snoozed once. Finish the challenge to stop this alarm.", 16f, colorTextSecondary).apply { gravity = Gravity.CENTER; setPadding(0, dp(18), 0, 0) })
  }

  private fun beginChallenge() {
    val difficulty = alarm.optString("difficulty", "Easy")
    val seed = abs(alarm.getString("alarmId").hashCode())
    when (difficulty) {
      "Easy" -> {
        val a = 3 + seed % 6; val b = 1 + seed % 3; val c = 5 + seed % 4; val d = 1 + seed % 4
        prompts = listOf("What is $a + $b?", "What is $c − $d?"); answers = listOf("${a + b}", "${c - d}")
      }
      "Medium" -> {
        val a = 24 + seed % 31; val b = 12 + seed % 17; val c = 61 + seed % 25; val d = 20 + seed % 20; val e = 33 + seed % 30; val f = 11 + seed % 19
        prompts = listOf("What is $a + $b?", "What is $c − $d?", "What is $e + $f?"); answers = listOf("${a + b}", "${c - d}", "${e + f}")
      }
      else -> {
        val passage = "Morning arrives quietly, and I meet it with patience. I breathe, sit up, place my feet on the floor, drink some water, and begin this new day with calm focus."
        prompts = listOf("Type this passage exactly:\n\n$passage"); answers = listOf(passage)
      }
    }
    step = 0
    showStep(difficulty)
  }

  private fun showStep(difficulty: String) {
    base()
    root.addView(label("$difficulty challenge", 16f, colorText).apply { setTypeface(typeface, android.graphics.Typeface.BOLD) })
    root.addView(label("Step ${step + 1} of ${prompts.size}", 14f, colorTextSecondary).apply { setPadding(0, dp(8), 0, dp(28)) })
    root.addView(label(prompts[step], if (difficulty == "Hard") 19f else 34f, colorText).apply { gravity = Gravity.CENTER })
    input = EditText(this).apply {
      setTextColor(colorText); setHintTextColor(colorSubtle); hint = if (difficulty == "Hard") "Type the passage" else "Your answer"
      background = rounded(colorSurface, 12); setPadding(dp(16), dp(14), dp(16), dp(14)); textSize = 17f
      if (difficulty != "Hard") inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED
      gravity = Gravity.TOP; minHeight = if (difficulty == "Hard") dp(150) else dp(58)
    }
    root.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(28) })
    val error = label("", 14f, colorError).apply { visibility = View.INVISIBLE; setPadding(0, dp(10), 0, 0) }
    root.addView(error)
    root.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 0, 1f) })
    root.addView(button(if (step == prompts.lastIndex) "I’m awake" else "Continue", true) {
      if (input?.text?.toString()?.trim() != answers[step]) { error.text = "That answer isn’t right yet. Try again."; error.visibility = View.VISIBLE; return@button }
      if (step < prompts.lastIndex) { step += 1; showStep(difficulty) } else complete()
    })
    input?.requestFocus()
  }

  private fun complete() {
    val alarmId = alarm.getString("alarmId")
    AlarmScheduler.complete(this, alarmId)
    val occurrenceId = alarm.optString("occurrenceId", alarmId)
    val launch = Intent(Intent.ACTION_VIEW, Uri.parse("zo-zar://wake/$occurrenceId?nativeCompleted=1")).apply { setPackage(packageName); addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP) }
    runCatching { startActivity(launch) }
    finish()
  }

  private fun rounded(color: Int, radiusDp: Int): GradientDrawable {
    val shape = GradientDrawable()
    shape.setCornerRadius(dp(radiusDp).toFloat())
    shape.setColor(color)
    return shape
  }

  private fun label(text: String, size: Float, color: Int) = TextView(this).apply { this.text = text; textSize = size; setTextColor(color); setLineSpacing(0f, 1.12f) }
  private fun button(text: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
    this.text = text; isAllCaps = false; textSize = 17f; minHeight = dp(62); minimumHeight = dp(62)
    setTextColor(if (primary) colorOnFill else colorText)
    val pressed = if (primary) Color.argb(48, 41, 35, 25) else Color.argb(36, 243, 237, 223)
    background = RippleDrawable(ColorStateList.valueOf(pressed), rounded(if (primary) colorFill else colorSurface, 16), null)
    stateListAnimator = null
    setPadding(dp(20), dp(12), dp(20), dp(12))
    setOnClickListener { action() }
    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) }
  }
  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
