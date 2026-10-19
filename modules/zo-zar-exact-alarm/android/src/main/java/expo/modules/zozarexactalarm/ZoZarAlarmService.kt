package expo.modules.zozarexactalarm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class ZoZarAlarmService : Service() {
  private var player: MediaPlayer? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val alarmId = intent?.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: return START_NOT_STICKY
    val alarm = AlarmStore.get(this, alarmId) ?: return START_NOT_STICKY
    val channelId = "zo-zar-native-alarm-v1-${alarm.optString("soundKey", "default")}".replace("_", "-")
    createChannel(channelId)
    val notification = NotificationCompat.Builder(this, channelId)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(alarm.optString("title", "ZO-ZAR wake alarm"))
      .setContentText("Wake up and complete your challenge.")
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setFullScreenIntent(AlarmScheduler.activityIntent(this, alarm), true)
      .setContentIntent(AlarmScheduler.activityIntent(this, alarm))
      .build()
    startForeground(alarmId.hashCode().let { if (it == 0) 7107 else kotlin.math.abs(it) }, notification)
    startSound(alarm.optString("soundKey", "default"))
    return START_STICKY
  }

  override fun onDestroy() {
    player?.stop(); player?.release(); player = null
    super.onDestroy()
  }

  private fun createChannel(id: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(id, "ZO-ZAR wake alarm", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Full-screen alarms created by you in ZO-ZAR"
      setSound(null, null)
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 500, 250, 500, 250, 800)
      lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
      setBypassDnd(true)
    }
    manager.createNotificationChannel(channel)
  }

  private fun startSound(soundKey: String) {
    val resourceName = when (soundKey) { "bright-rise", "zo-zar" -> "bright_rise"; "steady-pulse" -> "steady_pulse"; "summit-siren" -> "summit_siren"; else -> null }
    val resourceId = resourceName?.let { resources.getIdentifier(it, "raw", packageName) } ?: 0
    val uri = if (resourceId != 0) android.net.Uri.parse("android.resource://$packageName/$resourceId") else RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (audioManager.getStreamVolume(AudioManager.STREAM_ALARM) == 0) audioManager.setStreamVolume(AudioManager.STREAM_ALARM, (audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM) * 0.8).toInt(), 0)
    player = MediaPlayer().apply {
      setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
      setDataSource(this@ZoZarAlarmService, uri)
      isLooping = true
      prepare()
      start()
    }
  }
}
