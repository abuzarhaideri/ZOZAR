package expo.modules.zozarexactalarm

import android.app.Activity
import android.content.Intent
import android.graphics.Color
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
      setBackgroundColor(Color.rgb(8, 13, 21))
    }
    setContentView(root)
    root.addView(label("ZO-ZAR", 14f, Color.rgb(177, 186, 202)).apply { letterSpacing = .22f })
    root.addView(Space(this).apply { minimumHeight = dp(42) })
    return root
  }

  private fun showRing() {
    base()
    val time = java.text.SimpleDateFormat("h:mm a", java.util.Locale.getDefault()).format(java.util.Date())
    root.addView(label(time, 58f, Color.rgb(246, 244, 239)).apply { setTypeface(typeface, android.graphics.Typeface.BOLD) })
    root.addView(label(alarm.optString("title", "It’s time to wake up."), 24f, Color.rgb(246, 244, 239)).apply { gravity = Gravity.CENTER; setPadding(0, dp(12), 0, dp(8)) })
    root.addView(label("A gentle start. A clear first step.", 16f, Color.rgb(177, 186, 202)).apply { gravity = Gravity.CENTER })
    root.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 0, 1f) })
    root.addView(button("Wake Up", true) { beginChallenge() })
    if (alarm.optInt("snoozeCount", 0) < 1) root.addView(button("Sleep 5 More Minutes", false) { AlarmScheduler.snooze(this, alarm.getString("alarmId"), 5); finish() })
    else root.addView(label("Snooze was already used. Complete the challenge to stop this alarm.", 13f, Color.rgb(240, 172, 111)).apply { gravity = Gravity.CENTER; setPadding(0, dp(18), 0, 0) })
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
    root.addView(label("$difficulty challenge", 15f, Color.rgb(240, 172, 111)).apply { letterSpacing = .08f })
    root.addView(label("Step ${step + 1} of ${prompts.size}", 13f, Color.rgb(177, 186, 202)).apply { setPadding(0, dp(10), 0, dp(28)) })
    root.addView(label(prompts[step], if (difficulty == "Hard") 19f else 34f, Color.rgb(246, 244, 239)).apply { gravity = Gravity.CENTER })
    input = EditText(this).apply {
      setTextColor(Color.rgb(246, 244, 239)); setHintTextColor(Color.rgb(121, 132, 151)); hint = if (difficulty == "Hard") "Type the passage" else "Your answer"
      setBackgroundColor(Color.rgb(19, 28, 42)); setPadding(dp(16), dp(14), dp(16), dp(14)); textSize = 17f
      if (difficulty != "Hard") inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED
      gravity = Gravity.TOP; minHeight = if (difficulty == "Hard") dp(150) else dp(58)
    }
    root.addView(input, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(28) })
    val error = label("", 13f, Color.rgb(255, 117, 117)).apply { visibility = View.INVISIBLE; setPadding(0, dp(10), 0, 0) }
    root.addView(error)
    root.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 0, 1f) })
    root.addView(button(if (step == prompts.lastIndex) "Complete Wake" else "Continue", true) {
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

  private fun label(text: String, size: Float, color: Int) = TextView(this).apply { this.text = text; textSize = size; setTextColor(color); setLineSpacing(0f, 1.12f) }
  private fun button(text: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
    this.text = text; isAllCaps = false; textSize = 17f; minHeight = dp(58)
    setTextColor(if (primary) Color.WHITE else Color.rgb(219, 224, 235)); setBackgroundColor(if (primary) Color.rgb(53, 109, 255) else Color.rgb(19, 28, 42)); setOnClickListener { action() }
    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(62)).apply { topMargin = dp(12) }
  }
  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
