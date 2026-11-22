package com.kotalabs.crm.callsync

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
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
            root.addView(text("With your consent, this app reads your phone's call history after enrollment and sends identifiable incoming, outgoing and missed SIM call numbers, times, and available durations to your company CRM. This may include personal calls made on this phone. No audio is recorded. Calls may be missed if Android, your carrier or phone does not record or identify them. Your company administrator can revoke this device. Local queued calls remain until sent or deleted."))
            root.addView(text("On Android 12 or newer, Phone number permission is needed to inspect the call account; the app does not read your own phone number. Only use with your company's permission and a test account. This test build connects to ${BuildConfig.CRM_SYNC_ORIGIN}."))
            consent = CheckBox(this).apply { text = "I consent to this call-log access and CRM sync" }
            root.addView(consent)
            email = EditText(this).apply { hint = "CRM email"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS; isSingleLine = true }
            password = EditText(this).apply {
                hint = "CRM password"
                isSingleLine = true
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                transformationMethod = PasswordTransformationMethod.getInstance()
            }
            root.addView(email); root.addView(password)
            root.addView(button(if (busy) "Registering…" else "Allow and register") { requestRegistration() })
        } else {
            val count = try { Queue(this, secure).use { it.count("pending") } } catch (_: Exception) { -1 }
            root.addView(text("Device registered. ID: ${enrollment.deviceId}\nPending calls: ${if (count >= 0) count.toString() else "unavailable"}"))
            root.addView(text(SyncEngine.getStatus(this)))
            if (enrollment.outgoingSince == null) {
                root.addView(text("Outgoing SIM calls are not being synced. With your additional consent, outgoing numbers, times and available durations will also be sent to the company CRM. Only calls started after you consent are eligible. This may include personal calls; no audio is recorded."))
                root.addView(button("Consent to outgoing call sync") {
                    AlertDialog.Builder(this).setTitle("Sync outgoing calls?")
                        .setMessage("The CRM will receive identifiable outgoing SIM call numbers, times and available durations, including personal calls made on this phone. Only outgoing calls started after you agree will be synced. No audio is recorded.")
                        .setNegativeButton("Not now", null).setPositiveButton("I agree") { _, _ ->
                            try {
                                synchronized(SyncEngine.lock) {
                                    val current = secure.load()
                                    if (current != null && current.deviceId == enrollment.deviceId && current.outgoingSince == null) {
                                        secure.enableOutgoing(current, System.currentTimeMillis())
                                    }
                                }
                                Scheduler.ensure(this); Scheduler.manual(this); render()
                            } catch (_: Exception) { message("Could not save consent. Please try again.") }
                        }.show()
                })
            }
            val contactConsent = getSharedPreferences("sync_status", MODE_PRIVATE).getLong("contactsSince", 0L) > 0
            if (contactConsent) {
                val permitted = checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
                root.addView(text(if (permitted) "Saved-name sync is on for new calls." else "Saved-name sync is paused: Contacts permission is not granted."))
                if (!permitted) root.addView(button("Restore Contacts permission") { requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), 13) })
                root.addView(button("Stop saved-name sync") {
                    AlertDialog.Builder(this).setMessage("Stop looking up names for new calls? Previously sent names stay in the CRM, and already queued calls may still include names. Stop and remove local data to delete the unsent queue.")
                        .setNegativeButton("Cancel", null).setPositiveButton("Stop names") { _, _ ->
                            synchronized(SyncEngine.lock) { getSharedPreferences("sync_status", MODE_PRIVATE).edit().remove("contactsSince").commit() }
                            render()
                        }.show()
                })
            } else {
                root.addView(text("Optional: share the saved contact name for future calls with your company CRM. This may include personal contact names. Only the matching name and number for an eligible call are sent; the full address book is not uploaded. Existing names in the CRM are not replaced. Previously sent call details remain in the CRM."))
                root.addView(button("Enable saved-name sync") {
                    AlertDialog.Builder(this).setTitle("Share saved contact names?")
                        .setMessage("Allow this app to access Contacts and send the matching saved name for future eligible SIM calls to your company CRM? Calls may include personal contacts. This is optional and call sync works without it.")
                        .setNegativeButton("Not now", null).setPositiveButton("I agree") { _, _ ->
                            if (checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) enableContactSync()
                            else { permissionPending = true; requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS), 13) }
                        }.show()
                })
            }
            root.addView(text("Android may delay background work. A local check is requested after call-log changes and roughly every five minutes. No request is sent when there are no queued calls. Private numbers and calls without an identifiable SIM account are skipped."))
            val missing = requiredPermissions().filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
            if (missing.isNotEmpty()) root.addView(button("Restore call permissions") { requestPermissions(missing.toTypedArray(), 12) })
            root.addView(button("Check and sync now") {
                if (missing.isNotEmpty()) { message("Call logs and the requested Phone permissions are needed. Restore permissions first."); return@button }
                Scheduler.ensure(this); Scheduler.manual(this)
                AlertDialog.Builder(this).setMessage("Sync requested. Android may delay it. Reopen this screen to see the status.").setPositiveButton("OK", null).show()
            })
            root.addView(button("Stop and remove local data") { confirmStop(enrollment) })
        }
        setContentView(ScrollView(this).apply { addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) })
    }
    private fun requiredPermissions(): List<String> = buildList {
        add(Manifest.permission.READ_CALL_LOG)
        add(Manifest.permission.READ_PHONE_STATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) add(Manifest.permission.READ_PHONE_NUMBERS)
    }
    private fun requestRegistration() {
        if (busy) return
        if (!consent.isChecked) { message("Please read the disclosure and consent before registering."); return }
        if (email.text.toString().trim().isEmpty() || password.text.isEmpty()) { message("Enter your CRM email and password."); return }
        val missing = requiredPermissions().filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            permissionPending = true
            requestPermissions(missing.toTypedArray(), 11)
        } else enroll()
    }
    @Deprecated("Platform permission callback")
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 13) {
            permissionPending = false
            if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) enableContactSync()
            else { message("Contacts permission was not granted. Call sync can continue without saved names."); render() }
            return
        }
        if (requestCode == 12) {
            if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
                Scheduler.ensure(this); Scheduler.manual(this)
            } else message("The requested permissions are needed for SIM call sync.")
            render()
            return
        }
        if (requestCode != 11) return
        permissionPending = false
        if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) enroll()
        else message("Call logs and the requested Phone permissions are needed to identify SIM calls. You can change them in Android Settings.")
    }
    private fun enableContactSync() {
        synchronized(SyncEngine.lock) {
            val prefs = getSharedPreferences("sync_status", MODE_PRIVATE)
            if (prefs.getLong("contactsSince", 0L) == 0L) prefs.edit().putLong("contactsSince", System.currentTimeMillis()).commit()
        }
        Scheduler.ensure(this); Scheduler.manual(this); render()
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
            var stage = "sign in"
            var outcome = "Registration failed. Check your connection and credentials, then try again."
            try {
                val login = Api.post("/api/auth/login", JSONObject().put("email", username).put("password", secret))
                refresh = login.getString("refreshToken")
                stage = "check server settings"
                val capability = Api.get("/api/v1/call-sync/capability", login.getString("accessToken"))
                if (!capability.optBoolean("enabled", false)) {
                    outcome = "Call sync is not enabled on this CRM. Ask your administrator; do not enable it on live data before testing."
                    throw IllegalStateException("Sync not enabled")
                }
                val scope = UUID.randomUUID()
                val payload = JSONObject().put("deviceCode", scope.toString()).put("deviceName", "Android ${Build.MODEL}".take(120))
                    .put("manufacturer", Build.MANUFACTURER.take(120)).put("model", Build.MODEL.take(120))
                    .put("androidVersion", Build.VERSION.RELEASE.take(40)).put("appVersion", "0.1.0-test")
                stage = "register the device"
                val device = Api.post("/api/v1/devices/register", payload, login.getString("accessToken"))
                registered = true
                stage = "save registration"
                val started = System.currentTimeMillis()
                val enrollment = SecureStore.Enrollment(device.getString("deviceToken"), scope, started, device.getJSONObject("device").getString("id"), started)
                synchronized(SyncEngine.lock) {
                    SecureStore(this).save(enrollment)
                    Scheduler.ensure(this)
                    Scheduler.manual(this)
                }
                outcome = "Registration complete. Only calls started after registration are eligible."
            } catch (error: Exception) {
                outcome = when {
                    registered -> "The server registered the phone, but the app could not finish setup. Ask your administrator to revoke the newly registered device before trying again."
                    error is Api.HttpError && error.status == 401 && stage == "sign in" -> "Sign-in was rejected. Check the test email and password, then try again."
                    error is Api.HttpError -> "Could not $stage: server returned HTTP ${error.status}. Check the test server and try again."
                    error is UnknownHostException -> "Could not find the test server. Check the phone's internet connection and the test server address."
                    error is SSLException -> "Could not establish a secure connection to the test server. Check the phone's date and time and contact support."
                    error is SocketTimeoutException -> "Connection timed out while trying to $stage. Check the phone's internet connection and test server."
                    error is java.io.IOException -> "Could not connect to the test server while trying to $stage. Check the phone's internet connection and try again."
                    else -> outcome
                }
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
