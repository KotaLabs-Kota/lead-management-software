package com.kotalabs.crm.callprobe

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.pm.PackageManager
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.os.Bundle
import android.os.Build
import android.provider.CallLog
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.Executors

/** A deliberately local-only probe, not the production CRM sync app. */
class MainActivity : Activity() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var status: TextView
    private lateinit var results: TextView
    private lateinit var refresh: Button
    private var queryGeneration = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(24))
        }
        fun label(value: String, size: Float): TextView = TextView(this).apply {
            text = value
            textSize = size
            setPadding(0, 0, 0, dp(14))
        }
        page.addView(label("CRM Call Test", 24f))
        page.addView(label(
            "Feasibility test only. Reads the 50 most recent calls when you tap the button. " +
                "Call logs and Phone permissions let the app check call entries and whether Android identifies their account as a SIM. " +
                "On Android 12 or newer, Phone number permission is needed to inspect the phone account; this app does not read your own phone number. " +
                "Numbers are masked. Nothing is uploaded, recorded, or saved by this app.", 16f
        ))
        refresh = Button(this).apply {
            text = "Allow access and refresh calls"
            setOnClickListener { requestOrRefresh() }
        }
        page.addView(refresh, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        status = label("Tap the button to grant call history access and run the test.", 15f)
        status.setPadding(0, dp(16), 0, dp(12))
        page.addView(status)
        results = label("No calls loaded.", 16f).apply { gravity = Gravity.START }
        page.addView(results)
        setContentView(ScrollView(this).apply { addView(page) })
    }

    override fun onResume() {
        super.onResume()
        // Permissions can be revoked in Settings while the app is backgrounded.
        if (!hasPermissions()) {
            queryGeneration++
            if (::results.isInitialized) results.text = "No calls loaded."
            if (::refresh.isInitialized) refresh.isEnabled = true
            if (::status.isInitialized) status.text = "Call logs and Phone permissions are required. Tap the button to request them."
        }
    }

    private fun requiredPermissions(): List<String> = buildList {
        add(Manifest.permission.READ_CALL_LOG)
        add(Manifest.permission.READ_PHONE_STATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(Manifest.permission.READ_PHONE_NUMBERS)
    }
    private fun hasPermissions() = requiredPermissions().all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    private fun requestOrRefresh() {
        if (hasPermissions()) {
            loadCalls()
        } else {
            requestPermissions(requiredPermissions().filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }.toTypedArray(), CALL_LOG_REQUEST)
        }
    }

    @Deprecated("Platform callback is used to avoid external UI dependencies in this probe")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CALL_LOG_REQUEST) return
        if (hasPermissions()) {
            loadCalls()
        } else {
            results.text = "No calls loaded."
            status.text = "Permission denied. Enable Call logs and Phone under Android Settings → Apps → CRM Call Test → Permissions."
        }
    }

    private fun loadCalls() {
        val generation = ++queryGeneration
        refresh.isEnabled = false
        status.text = "Reading call history on this phone…"
        worker.execute {
            val outcome = try {
                readRecentCalls()
            } catch (_: SecurityException) {
                "Could not read call history. Check the app's permission in Android Settings."
            } catch (_: Exception) {
                // Do not log phone numbers or other sensitive call details.
                "Could not read call history on this phone. Please retry after checking permissions."
            }
            runOnUiThread {
                if (isFinishing || isDestroyed || generation != queryGeneration) return@runOnUiThread
                refresh.isEnabled = true
                if (!hasPermissions()) {
                    results.text = "No calls loaded."
                    status.text = "Call history permission is no longer granted."
                } else {
                    results.text = outcome
                    status.text = "Refresh after each test call. Outcomes depend on what this phone records."
                }
            }
        }
    }

    private fun readRecentCalls(): String {
        val fields = arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION,
            CallLog.Calls.NUMBER_PRESENTATION, CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME, CallLog.Calls.PHONE_ACCOUNT_ID)
        val cursor = contentResolver.query(CallLog.Calls.CONTENT_URI, fields, null, null, "${CallLog.Calls.DATE} DESC")
            ?: return "Call history is unavailable on this phone."
        val entries = mutableListOf<String>()
        val reasons = linkedMapOf<String, Int>()
        val telecom = getSystemService(TelecomManager::class.java)
        cursor.use {
            val numberCol = it.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val typeCol = it.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val dateCol = it.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val durationCol = it.getColumnIndexOrThrow(CallLog.Calls.DURATION)
            val presentationCol = it.getColumnIndexOrThrow(CallLog.Calls.NUMBER_PRESENTATION)
            val componentCol = it.getColumnIndexOrThrow(CallLog.Calls.PHONE_ACCOUNT_COMPONENT_NAME)
            val accountCol = it.getColumnIndexOrThrow(CallLog.Calls.PHONE_ACCOUNT_ID)
            val formatter = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
            while (entries.size < 50 && it.moveToNext()) {
                val number = if (it.isNull(numberCol)) null else it.getString(numberCol)
                val type = if (it.isNull(typeCol)) "Unknown" else describeType(it.getInt(typeCol))
                val date = if (it.isNull(dateCol) || it.getLong(dateCol) <= 0) "Time unavailable" else formatter.format(Date(it.getLong(dateCol)))
                val duration = if (it.isNull(durationCol)) "Duration unavailable" else "${it.getLong(durationCol)} seconds"
                val callType = if (it.isNull(typeCol)) -1 else it.getInt(typeCol)
                val eligibility = if (callType == CallLog.Calls.INCOMING_TYPE || callType == CallLog.Calls.MISSED_TYPE) {
                    val component = if (it.isNull(componentCol)) null else ComponentName.unflattenFromString(it.getString(componentCol))
                    val accountId = if (it.isNull(accountCol)) null else it.getString(accountCol)
                    var accountPermissionDenied = false
                    val account = if (component != null && accountId != null) try {
                        telecom?.getPhoneAccount(PhoneAccountHandle(component, accountId))
                    } catch (_: SecurityException) { accountPermissionDenied = true; null } else null
                    when {
                        it.isNull(dateCol) || it.getLong(dateCol) <= 0 -> "Time missing"
                        component == null || accountId == null -> "Phone account ID missing"
                        accountPermissionDenied -> "Phone account access denied"
                        account == null -> "Phone account unavailable to app"
                        !account.hasCapabilities(PhoneAccount.CAPABILITY_SIM_SUBSCRIPTION) -> "Account not identified as SIM"
                        it.isNull(presentationCol) || it.getInt(presentationCol) != CallLog.Calls.PRESENTATION_ALLOWED -> "Caller presentation unavailable or restricted"
                        number.isNullOrBlank() || number.trim().length > 30 || number.count { digit -> digit.isDigit() } < 7 -> "Caller number missing or too short"
                        else -> "Passed local eligibility checks"
                    }.also { reason -> reasons[reason] = (reasons[reason] ?: 0) + 1 }
                } else "Not an incoming or missed call"
                entries.add("$type  ·  ${maskNumber(number)}\n$date  ·  $duration\n$eligibility")
            }
        }
        val summary = if (reasons.isEmpty()) "No incoming or missed entries in the latest 50 calls."
            else reasons.entries.joinToString("\n") { (reason, count) -> "$reason: $count" }
        return "Local eligibility summary (latest 50; may include older calls):\n$summary\n\n" +
            if (entries.isEmpty()) "No calls found in this phone's history." else entries.joinToString("\n\n")
    }

    private fun describeType(type: Int): String = when (type) {
        CallLog.Calls.INCOMING_TYPE -> "Incoming"
        CallLog.Calls.OUTGOING_TYPE -> "Outgoing"
        CallLog.Calls.MISSED_TYPE -> "Missed"
        CallLog.Calls.REJECTED_TYPE -> "Rejected"
        CallLog.Calls.BLOCKED_TYPE -> "Blocked"
        CallLog.Calls.VOICEMAIL_TYPE -> "Voicemail"
        else -> "Other / unknown ($type)"
    }

    private fun maskNumber(number: String?): String {
        val digits = number.orEmpty().filter { it.isDigit() }
        return if (digits.isEmpty()) "Number unavailable" else "•••• ${digits.takeLast(4)}"
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        queryGeneration++
        worker.shutdownNow()
        super.onDestroy()
    }

    companion object { private const val CALL_LOG_REQUEST = 1001 }
}
