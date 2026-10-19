package expo.modules.zozarexactalarm

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal object AlarmStore {
  private const val PREFS = "zo_zar_native_alarms_v1"
  private const val ALARMS = "alarms"
  private const val LAUNCH = "launch_alarm"
  private const val EVENTS = "pending_events"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun all(context: Context): MutableMap<String, JSONObject> {
    val root = JSONObject(prefs(context).getString(ALARMS, "{}") ?: "{}")
    val result = mutableMapOf<String, JSONObject>()
    root.keys().forEach { key -> result[key] = root.getJSONObject(key) }
    return result
  }

  fun get(context: Context, id: String): JSONObject? = all(context)[id]

  fun put(context: Context, alarm: JSONObject) {
    val alarms = all(context)
    alarms[alarm.getString("alarmId")] = alarm
    write(context, alarms)
  }

  fun remove(context: Context, id: String) {
    val alarms = all(context)
    alarms.remove(id)
    write(context, alarms)
  }

  fun setLaunch(context: Context, alarm: JSONObject?) {
    prefs(context).edit().putString(LAUNCH, alarm?.toString()).apply()
  }

  fun launch(context: Context): JSONObject? {
    val value = prefs(context).getString(LAUNCH, null) ?: return null
    return runCatching { JSONObject(value) }.getOrNull()
  }

  fun addEvent(context: Context, type: String, alarm: JSONObject) {
    val events = pendingEvents(context)
    events.put(JSONObject().put("eventId", "${type}-${System.currentTimeMillis()}").put("type", type).put("alarmId", alarm.optString("alarmId")).put("occurrenceId", alarm.optString("occurrenceId")).put("createdAtMillis", System.currentTimeMillis()))
    prefs(context).edit().putString(EVENTS, events.toString()).apply()
  }

  fun pendingEvents(context: Context): JSONArray = runCatching { JSONArray(prefs(context).getString(EVENTS, "[]")) }.getOrElse { JSONArray() }

  fun acknowledgeEvent(context: Context, eventId: String) {
    val current = pendingEvents(context)
    val next = JSONArray()
    for (index in 0 until current.length()) if (current.getJSONObject(index).optString("eventId") != eventId) next.put(current.getJSONObject(index))
    prefs(context).edit().putString(EVENTS, next.toString()).apply()
  }

  fun fromMap(payload: Map<String, Any?>): JSONObject = JSONObject().apply {
    payload.forEach { (key, value) ->
      put(key, when (value) {
        is List<*> -> JSONArray(value)
        null -> JSONObject.NULL
        else -> value
      })
    }
    if (!has("weekdays")) put("weekdays", JSONArray())
    if (!has("snoozeCount")) put("snoozeCount", 0)
  }

  fun toMap(value: JSONObject): Map<String, Any?> {
    val result = mutableMapOf<String, Any?>()
    value.keys().forEach { key ->
      result[key] = when (val item = value.get(key)) {
        is JSONArray -> (0 until item.length()).map { item.get(it) }
        JSONObject.NULL -> null
        else -> item
      }
    }
    return result
  }

  private fun write(context: Context, alarms: Map<String, JSONObject>) {
    val root = JSONObject()
    alarms.forEach { (key, value) -> root.put(key, value) }
    prefs(context).edit().putString(ALARMS, root.toString()).apply()
  }
}
