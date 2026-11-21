package com.kotalabs.crm.callsync

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var root: LinearLayout
    private var permissionPending = false
    private var busy = false
    private lateinit var email: EditText
    private lateinit var password: EditText
    private lateinit var consent: CheckBox

    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); render() }
    override fun onResume() {
        super.onResume()
        try { if (SecureStore(this).load() != null) Scheduler.ensure(this) } catch (_: Exception) { }
        if (::root.isInitialized && !busy && !permissionPending) render()
    }
    private fun text(value: String, size: Float = 16f): TextView = TextView(this).apply {
        text = value; textSize = size; setPadding(0, 0, 0, dp(14))
    }
    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label; isEnabled = !busy; setOnClickListener { action() }
    }
    private fun render() {
        if (isFinishing || isDestroyed) return
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(24), dp(20), dp(24)) }
        root.addView(text("CRM Call Sync · test", 24f))
        val secure = SecureStore(this)
        val enrollment = try { secure.load() } catch (_: Exception) {
            root.addView(text("Cannot read encrypted registration. Ask an administrator to revoke this device, then clear app data and register again."))
            setContentView(ScrollView(this).apply { addView(root) }); return
        }
        if (enrollment == null) {
            root.addView(text("With your consent, this app reads your phone's call history after enrollment and sends identifiable incoming and missed SIM call numbers, times, and available durations to your company CRM. No audio is recorded. Calls may be missed if Android, your carrier or phone does not record or identify them. Your company administrator can revoke this device. Local queued calls remain until sent or deleted."))
            root.addView(text("Only use with your company's permission and a test account. This test build connects to ${BuildConfig.CRM_SYNC_ORIGIN}."))
            consent = CheckBox(this).apply { text = "I consent to this call-log access and CRM sync" }
            root.addView(consent)
            email = EditText(this).apply { hint = "CRM email"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS; isSingleLine = true }
            password = EditText(this).apply { hint = "CRM password"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; isSingleLine = true }
            root.addView(email); root.addView(password)
            root.addView(button(if (busy) "Registering…" else "Allow and register") { requestRegistration() })
        } else {
            val count = try { Queue(this, secure).use { it.count("pending") } } catch (_: Exception) { -1 }
            root.addView(text("Device registered. ID: ${enrollment.deviceId}\nPending calls: ${if (count >= 0) count.toString() else "unavailable"}"))
            root.addView(text(SyncEngine.getStatus(this)))
            root.addView(text("Android may delay background work. A local check is requested after call-log changes and roughly every five minutes. No request is sent when there are no queued calls. Private numbers and calls without an identifiable SIM account are skipped."))
            val missing = arrayOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            if (missing.isNotEmpty()) root.addView(button("Restore call permissions") { requestPermissions(missing.toTypedArray(), 12) })
            root.addView(button("Check and sync now") {
                if (missing.isNotEmpty()) { message("Both Call logs and Phone permissions are needed. Restore permissions first."); return@button }
                Scheduler.ensure(this); Scheduler.manual(this)
                AlertDialog.Builder(this).setMessage("Sync requested. Android may delay it. Reopen this screen to see the status.").setPositiveButton("OK", null).show()
            })
            root.addView(button("Stop and remove local data") { confirmStop(enrollment) })
        }
        setContentView(ScrollView(this).apply { addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) })
    }
    private fun requestRegistration() {
        if (busy) return
        if (!consent.isChecked) { message("Please read the disclosure and consent before registering."); return }
        if (email.text.toString().trim().isEmpty() || password.text.isEmpty()) { message("Enter your CRM email and password."); return }
        val missing = arrayOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE).filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            permissionPending = true
            requestPermissions(missing.toTypedArray(), 11)
        } else enroll()
    }
    @Deprecated("Platform permission callback")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 12) {
            if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                Scheduler.ensure(this); Scheduler.manual(this)
            } else message("Both permissions are needed for SIM call sync.")
            render()
            return
        }
        if (requestCode != 11) return
        permissionPending = false
        if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) enroll()
        else message("Both Call logs and Phone permissions are needed to identify SIM calls. You can change them in Android Settings.")
    }
    private fun enroll() {
        val username = email.text.toString().trim()
        val secret = password.text.toString()
        password.text.clear()
        busy = true
        // Keep the current fields on screen while the network operation is in progress.
        executor.execute {
            var refresh: String? = null
            var registered = false
            var outcome = "Registration failed. Check your connection and credentials, then try again."
            try {
                val login = Api.post("/api/auth/login", JSONObject().put("email", username).put("password", secret))
                refresh = login.getString("refreshToken")
                val capability = Api.get("/api/v1/call-sync/capability", login.getString("accessToken"))
                if (!capability.optBoolean("enabled", false)) {
                    outcome = "Call sync is not enabled on this CRM. Ask your administrator; do not enable it on live data before testing."
                    throw IllegalStateException("Sync not enabled")
                }
                val scope = UUID.randomUUID()
                val payload = JSONObject().put("deviceCode", scope.toString()).put("deviceName", "Android ${Build.MODEL}".take(120))
                    .put("manufacturer", Build.MANUFACTURER.take(120)).put("model", Build.MODEL.take(120))
                    .put("androidVersion", Build.VERSION.RELEASE.take(40)).put("appVersion", "0.1.0-test")
                val device = Api.post("/api/v1/devices/register", payload, login.getString("accessToken"))
                registered = true
                val enrollment = SecureStore.Enrollment(device.getString("deviceToken"), scope, System.currentTimeMillis(), device.getJSONObject("device").getString("id"))
                synchronized(SyncEngine.lock) {
                    SecureStore(this).save(enrollment)
                    Scheduler.ensure(this)
                    Scheduler.manual(this)
                }
                outcome = "Registration complete. Only calls started after registration are eligible."
            } catch (_: Exception) {
                if (registered) outcome = "Registration could not be saved securely. Ask your administrator to revoke the newly registered device before trying again."
            } finally {
                if (refresh != null) try { Api.post("/api/auth/logout", JSONObject().put("refreshToken", refresh)) } catch (_: Exception) { }
            }
            runOnUiThread { busy = false; if (!isFinishing && !isDestroyed) { render(); message(outcome) } }
        }
        message("Registering securely. This can take a minute if the server is waking up.")
    }
    private fun confirmStop(e: SecureStore.Enrollment) {
        if (busy) return
        AlertDialog.Builder(this).setTitle("Stop syncing?")
            .setMessage("This deletes unsent calls stored in the app. It attempts to revoke the device on the server. If offline or revocation fails, ask your administrator to revoke device ${e.deviceId} in CRM. Calls already sent remain in the CRM.")
            .setNegativeButton("Cancel", null).setPositiveButton("Stop and delete") { _, _ ->
                busy = true
                executor.execute {
                    var revoked = false
                    var cleared = false
                    synchronized(SyncEngine.lock) {
                        Scheduler.cancel(this)
                        try { Api.post("/api/v1/devices/self/revoke", JSONObject(), e.token); revoked = true } catch (_: Exception) { }
                        try { Queue(this, SecureStore(this)).use { it.clearAll() }; SecureStore(this).clear(); cleared = true } catch (_: Exception) { }
                        getSharedPreferences("sync_status", MODE_PRIVATE).edit().clear().commit()
                        Scheduler.cancel(this)
                    }
                    runOnUiThread {
                        busy = false
                        if (!isFinishing && !isDestroyed) {
                            render()
                            message(when {
                                !cleared -> "Local data could not be removed. Clear this app's data in Android Settings. Ask your administrator to check device ${e.deviceId}."
                                revoked -> "Device revoked and local queue removed."
                                else -> "Local queue removed, but revocation could not be confirmed. Ask your administrator to revoke device ${e.deviceId} now."
                            })
                        }
                    }
                }
            }.show()
    }
    private fun message(value: String) { if (!isFinishing && !isDestroyed) AlertDialog.Builder(this).setMessage(value).setPositiveButton("OK", null).show() }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    override fun onDestroy() { executor.shutdown(); super.onDestroy() }
}
