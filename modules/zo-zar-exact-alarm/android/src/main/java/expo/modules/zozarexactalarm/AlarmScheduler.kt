package expo.modules.zozarexactalarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import java.util.Calendar

internal object AlarmScheduler {
  const val EXTRA_ALARM_ID = "alarmId"

  fun schedule(context: Context, alarm: JSONObject) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
      throw IllegalStateException("Android precise-alarm access is not enabled.")
    }
    val triggerAt = alarm.getLong("triggerAtMillis")
    if (triggerAt <= System.currentTimeMillis()) throw IllegalArgumentException("The alarm time must be in the future.")
    val id = alarm.getString("alarmId")
    AlarmStore.put(context, alarm)
    manager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, activityIntent(context, alarm)), receiverIntent(context, id))
  }

  fun cancel(context: Context, alarmId: String) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    manager.cancel(receiverIntent(context, alarmId))
    AlarmStore.remove(context, alarmId)
    if (AlarmStore.launch(context)?.optString("alarmId") == alarmId) AlarmStore.setLaunch(context, null)
    context.stopService(Intent(context, ZoZarAlarmService::class.java).putExtra(EXTRA_ALARM_ID, alarmId))
  }

  fun snooze(context: Context, alarmId: String, minutes: Int) {
    val alarm = AlarmStore.get(context, alarmId) ?: throw IllegalStateException("Alarm not found.")
    if (alarm.optInt("snoozeCount", 0) >= 1) throw IllegalStateException("This alarm has already been snoozed.")
    stopRinging(context, alarmId)
    alarm.put("snoozeCount", 1)
    AlarmStore.addEvent(context, "snoozed", alarm)
    alarm.put("triggerAtMillis", System.currentTimeMillis() + minutes.coerceAtLeast(1) * 60_000L)
    schedule(context, alarm)
  }

  fun complete(context: Context, alarmId: String) {
    stopRinging(context, alarmId)
    val alarm = AlarmStore.get(context, alarmId)
    if (alarm != null) AlarmStore.addEvent(context, "completed", alarm)
    if (alarm?.optString("recurrence") == "once") AlarmStore.remove(context, alarmId)
    AlarmStore.setLaunch(context, alarm?.put("completedAtMillis", System.currentTimeMillis()))
  }

  fun stopRinging(context: Context, alarmId: String) {
    context.stopService(Intent(context, ZoZarAlarmService::class.java).putExtra(EXTRA_ALARM_ID, alarmId))
  }

  fun rescheduleRecurring(context: Context, alarm: JSONObject) {
    when (alarm.optString("recurrence", "once")) {
      "daily" -> alarm.put("triggerAtMillis", nextDaily(alarm))
      "weekly" -> alarm.put("triggerAtMillis", nextWeekly(alarm))
      else -> return
    }
    alarm.put("snoozeCount", 0)
    schedule(context, alarm)
  }

  fun restoreAll(context: Context) {
    AlarmStore.all(context).values.forEach { alarm ->
      runCatching {
        if (alarm.getLong("triggerAtMillis") <= System.currentTimeMillis()) {
          when (alarm.optString("recurrence", "once")) {
            "daily" -> alarm.put("triggerAtMillis", nextDaily(alarm))
            "weekly" -> alarm.put("triggerAtMillis", nextWeekly(alarm))
            else -> return@runCatching
          }
        }
        schedule(context, alarm)
      }
    }
  }

  private fun nextDaily(alarm: JSONObject): Long = Calendar.getInstance().apply {
    set(Calendar.HOUR_OF_DAY, alarm.optInt("hour", 7)); set(Calendar.MINUTE, alarm.optInt("minute", 0)); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
  }.timeInMillis

  private fun nextWeekly(alarm: JSONObject): Long {
    val weekdays = alarm.optJSONArray("weekdays") ?: return nextDaily(alarm)
    val selected = (0 until weekdays.length()).map { weekdays.optInt(it) }.toSet()
    val base = Calendar.getInstance()
    for (offset in 0..7) {
      val candidate = base.clone() as Calendar
      candidate.add(Calendar.DAY_OF_YEAR, offset)
      candidate.set(Calendar.HOUR_OF_DAY, alarm.optInt("hour", 7)); candidate.set(Calendar.MINUTE, alarm.optInt("minute", 0)); candidate.set(Calendar.SECOND, 0); candidate.set(Calendar.MILLISECOND, 0)
      val jsWeekday = candidate.get(Calendar.DAY_OF_WEEK) - 1
      if (selected.contains(jsWeekday) && candidate.timeInMillis > System.currentTimeMillis()) return candidate.timeInMillis
    }
    throw IllegalStateException("No future weekday could be scheduled.")
  }

  private fun receiverIntent(context: Context, alarmId: String) = PendingIntent.getBroadcast(context, alarmId.hashCode(), Intent(context, ZoZarAlarmReceiver::class.java).putExtra(EXTRA_ALARM_ID, alarmId), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  fun activityIntent(context: Context, alarm: JSONObject) = PendingIntent.getActivity(context, alarm.getString("alarmId").hashCode(), Intent(context, ZoZarAlarmActivity::class.java).putExtra(EXTRA_ALARM_ID, alarm.getString("alarmId")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
}
