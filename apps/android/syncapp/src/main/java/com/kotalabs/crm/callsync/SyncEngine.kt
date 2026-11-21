package com.kotalabs.crm.callsync

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

internal object SyncEngine {
    // All scan/upload/stop operations share this lock; never run overlapping uploads.
    val lock = Any()
    private fun status(context: Context, message: String) {
        context.getSharedPreferences("sync_status", Context.MODE_PRIVATE).edit().putString("status", message).apply()
    }
    fun getStatus(context: Context) = context.getSharedPreferences("sync_status", Context.MODE_PRIVATE).getString("status", "Not synced yet.") ?: ""
    private fun permitted(context: Context) =
        context.checkSelfPermission(Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED &&
        context.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED

    fun run(context: Context) = synchronized(lock) {
        val secure = SecureStore(context)
        val enrollment = secure.load() ?: return@synchronized
        if (secure.isBlocked()) { status(context, "Device access stopped by server. Ask your administrator to check the device."); return@synchronized }
        if (!permitted(context)) { status(context, "Permission missing. Open the app and allow Call logs and Phone."); return@synchronized }
        Queue(context, secure).use { queue ->
            val skipped = scan(context, enrollment, queue)
            val count = queue.count("pending")
            if (count == 0) {
                status(context, if (skipped > 0) "No calls queued. $skipped entries were skipped and not sent." else "No calls queued.")
                return@synchronized
            }
            val prefs = context.getSharedPreferences("sync_status", Context.MODE_PRIVATE)
            if (System.currentTimeMillis() < prefs.getLong("retryAt", 0)) {
                status(context, "$count call(s) waiting to retry. $skipped entries skipped.")
                return@synchronized
            }
            val batch = queue.pending()
            if (batch.isEmpty()) { status(context, "$count call(s) waiting for a later retry. Contact your administrator if this persists."); return@synchronized }
            val events = JSONArray()
            batch.forEach { events.put(it.second) }
            try {
                val response = Api.post("/api/v1/call-sync/events", JSONObject().put("events", events), enrollment.token)
                val results = response.getJSONArray("results")
                val sent = batch.map { it.first }.toSet()
                val acknowledged = mutableSetOf<String>()
                for (i in 0 until results.length()) {
                    val result = results.getJSONObject(i)
                    val id = result.optString("eventId")
                    if (id in sent && result.optString("status") in setOf("created", "duplicate")) acknowledged.add(id)
                }
                queue.acknowledge(acknowledged)
                val remaining = queue.count("pending")
                if (acknowledged.size < batch.size) {
                    // Defer only unacknowledged items so they cannot starve later calls.
                    queue.defer(sent - acknowledged)
                    status(context, "$remaining call(s) waiting; server did not accept every item. Contact your administrator.")
                } else {
                    prefs.edit().remove("retryAt").remove("failures").apply()
                    status(context, "Sync completed. $remaining call(s) waiting; $skipped entries skipped.")
                }
            } catch (e: Api.HttpError) {
                if (e.status == 401 || e.status == 403) {
                    secure.block()
                    status(context, "Device access rejected. Ask your administrator to check registration.")
                } else {
                    backoff(prefs)
                    status(context, "$count call(s) waiting; server unavailable (HTTP ${e.status}).")
                }
            } catch (_: Exception) {
                backoff(prefs)
                status(context, "$count call(s) waiting; connection failed. Will retry later.")
            }
        }
    }
    private fun backoff(prefs: android.content.SharedPreferences) {
        val failures = (prefs.getInt("failures", 0) + 1).coerceAtMost(5)
        // Five minutes, then exponential backoff up to 80 minutes, plus jitter.
        val delay = (5 * 60 * 1000L) * (1L shl (failures - 1)) + (0..30000).random()
        prefs.edit().putInt("failures", failures).putLong("retryAt", System.currentTimeMillis() + delay).apply()
    }
    private fun scan(context: Context, enrollment: SecureStore.Enrollment, queue: Queue): Int {
        val fields = arrayOf(CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.NUMBER_PRESENTATION,
            CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION,
            CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME, CallLog.Calls.PHONE_ACCOUNT_ID)
        val telecom = context.getSystemService(TelecomManager::class.java)
        var skipped = 0
        val cursor = context.contentResolver.query(CallLog.Calls.CONTENT_URI, fields,
            "${CallLog.Calls.DATE} >= ?", arrayOf(enrollment.started.toString()), "${CallLog.Calls.DATE} ASC")
            ?: error("Call log unavailable")
        cursor.use { c ->
            val idCol = c.getColumnIndexOrThrow(CallLog.Calls._ID)
            val numberCol = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val presentationCol = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER_PRESENTATION)
            val typeCol = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val dateCol = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val durationCol = c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
            val componentCol = c.getColumnIndexOrThrow(CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME)
            val accountCol = c.getColumnIndexOrThrow(CallLog.Calls.PHONE_ACCOUNT_ID)
            while (c.moveToNext()) {
                val direction = when (c.getInt(typeCol)) {
                    CallLog.Calls.INCOMING_TYPE -> "INCOMING"
                    CallLog.Calls.MISSED_TYPE -> "MISSED"
                    else -> continue
                }
                val started = c.getLong(dateCol)
                if (started <= 0) { skipped++; continue }
                val id = SyncPolicy.eventId(enrollment.scope, c.getLong(idCol), started).toString()
                if (queue.contains(id)) continue
                val component = if (c.isNull(componentCol)) null else ComponentName.unflattenFromString(c.getString(componentCol))
                val accountId = if (c.isNull(accountCol)) null else c.getString(accountCol)
                // Never label an unknown/VoIP account as SIM. Some OEMs omit these fields;
                // such calls are reported as skipped rather than guessed.
                val account = if (component != null && accountId != null) try {
                    telecom?.getPhoneAccount(PhoneAccountHandle(component, accountId))
                } catch (_: SecurityException) { null } else null
                val number = if (c.isNull(numberCol)) null else c.getString(numberCol)?.trim()
                if (account?.hasCapabilities(PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION) != true ||
                    c.isNull(presentationCol) || c.getInt(presentationCol) != CallLog.Calls.PRESENTATION_ALLOWED ||
                    number.isNullOrEmpty() || number.length > 30 || number.count { it.isDigit() } < 7) {
                    skipped++; continue
                }
                val event = JSONObject().put("eventId", id).put("phoneNumber", number)
                    .put("direction", direction).put("source", "SIM").put("captureMethod", "CALL_LOG")
                    .put("startedAt", Instant.ofEpochMilli(started).toString())
                if (!c.isNull(durationCol) && c.getLong(durationCol) in 0..86400) event.put("durationSeconds", c.getLong(durationCol))
                queue.add(id, event)
            }
        }
        return skipped
    }
}
