package expo.modules.zozarexactalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class ZoZarAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: return
    val alarm = AlarmStore.get(context, alarmId) ?: return
    AlarmStore.setLaunch(context, alarm)
    val service = Intent(context, ZoZarAlarmService::class.java).putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(service) else context.startService(service)
    runCatching { AlarmScheduler.rescheduleRecurring(context, alarm) }
  }
}
