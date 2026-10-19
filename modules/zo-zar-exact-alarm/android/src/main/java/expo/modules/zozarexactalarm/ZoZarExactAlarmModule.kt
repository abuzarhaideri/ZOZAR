package expo.modules.zozarexactalarm

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ZoZarExactAlarmModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZoZarExactAlarm")

    AsyncFunction("getStatus") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return@AsyncFunction "granted"
      }

      val context = appContext.reactContext
        ?: throw IllegalStateException("React context is unavailable.")
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        ?: throw IllegalStateException("AlarmManager is unavailable.")

      if (alarmManager.canScheduleExactAlarms()) "granted" else "not-granted"
    }

    AsyncFunction("getFullScreenAlarmStatus") {
      val context = appContext.reactContext ?: return@AsyncFunction "unknown"
      if (Build.VERSION.SDK_INT < 34) return@AsyncFunction "granted"
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return@AsyncFunction "unknown"
      if (manager.canUseFullScreenIntent()) "granted" else "not-granted"
    }

    AsyncFunction("scheduleAlarm") { payload: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      AlarmScheduler.schedule(context, AlarmStore.fromMap(payload))
    }

    AsyncFunction("cancelAlarm") { alarmId: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      AlarmScheduler.cancel(context, alarmId)
    }

    AsyncFunction("snoozeAlarm") { alarmId: String, minutes: Int ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      AlarmScheduler.snooze(context, alarmId, minutes)
    }

    AsyncFunction("completeAlarm") { alarmId: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      AlarmScheduler.complete(context, alarmId)
    }

    AsyncFunction("getScheduledAlarms") {
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      AlarmStore.all(context).values.map(AlarmStore::toMap)
    }

    AsyncFunction("getLaunchAlarm") {
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      AlarmStore.launch(context)?.let(AlarmStore::toMap)
    }

    AsyncFunction("getPendingEvents") {
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      val events = AlarmStore.pendingEvents(context)
      (0 until events.length()).map { AlarmStore.toMap(events.getJSONObject(it)) }
    }

    AsyncFunction("acknowledgePendingEvent") { eventId: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      AlarmStore.acknowledgeEvent(context, eventId)
    }
  }
}
