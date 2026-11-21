package com.kotalabs.crm.callprobe

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
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
        if (checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            queryGeneration++
            if (::results.isInitialized) results.text = "No calls loaded."
            if (::refresh.isInitialized) refresh.isEnabled = true
            if (::status.isInitialized) status.text = "Call history permission is required. Tap the button to request it."
        }
    }

    private fun requestOrRefresh() {
        if (checkSelfPermission(Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) {
            loadCalls()
        } else {
            requestPermissions(arrayOf(Manifest.permission.READ_CALL_LOG), CALL_LOG_REQUEST)
        }
    }

    @Deprecated("Platform callback is used to avoid external UI dependencies in this probe")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CALL_LOG_REQUEST) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            loadCalls()
        } else {
            results.text = "No calls loaded."
            status.text = "Permission denied. To try again, use the button or enable Call logs in Android Settings → Apps → CRM Call Test → Permissions."
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
                if (checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
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
        val fields = arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION)
        val cursor = contentResolver.query(CallLog.Calls.CONTENT_URI, fields, null, null, "${CallLog.Calls.DATE} DESC")
            ?: return "Call history is unavailable on this phone."
        val entries = mutableListOf<String>()
        cursor.use {
            val numberCol = it.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val typeCol = it.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val dateCol = it.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val durationCol = it.getColumnIndexOrThrow(CallLog.Calls.DURATION)
            val formatter = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
            while (entries.size < 50 && it.moveToNext()) {
                val number = if (it.isNull(numberCol)) null else it.getString(numberCol)
                val type = if (it.isNull(typeCol)) "Unknown" else describeType(it.getInt(typeCol))
                val date = if (it.isNull(dateCol) || it.getLong(dateCol) <= 0) "Time unavailable" else formatter.format(Date(it.getLong(dateCol)))
                val duration = if (it.isNull(durationCol)) "Duration unavailable" else "${it.getLong(durationCol)} seconds"
                entries.add("$type  ·  ${maskNumber(number)}\n$date  ·  $duration")
            }
        }
        return if (entries.isEmpty()) "No calls found in this phone's history." else entries.joinToString("\n\n")
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
