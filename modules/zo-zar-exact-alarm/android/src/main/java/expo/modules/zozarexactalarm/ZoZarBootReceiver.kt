package expo.modules.zozarexactalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ZoZarBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) AlarmScheduler.restoreAll(context)
  }
}
