package com.kotalabs.crm.callsync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Android Keystore key never leaves the device. No plaintext token or queued phone numbers. */
internal class SecureStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("sync", Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    data class Enrollment(val token: String, val scope: UUID, val started: Long, val deviceId: String, val outgoingSince: Long? = null)

    @Synchronized private fun key(create: Boolean): SecretKey {
        val key = keyStore.getKey(KEY, null) as? SecretKey
        if (key != null) return key
        check(create) { "Encryption key unavailable. Ask an administrator to revoke this device." }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
    fun encrypt(text: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(true))
        return JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(text.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)).toString()
    }
    fun decrypt(text: String): String {
        val data = JSONObject(text)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, Base64.decode(data.getString("iv"), Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(data.getString("data"), Base64.NO_WRAP)), Charsets.UTF_8)
    }
    fun save(e: Enrollment) {
        require(e.token.startsWith("dvc_") && e.started > 0)
        val value = JSONObject().put("token", e.token).put("scope", e.scope.toString())
            .put("started", e.started).put("deviceId", e.deviceId).put("outgoingSince", e.outgoingSince ?: JSONObject.NULL)
        check(prefs.edit().putString("enrollment", encrypt(value.toString())).putBoolean("blocked", false).commit())
    }
    fun load(): Enrollment? {
        val s = prefs.getString("enrollment", null) ?: return null
        val o = JSONObject(decrypt(s))
        return Enrollment(o.getString("token"), UUID.fromString(o.getString("scope")), o.getLong("started"), o.getString("deviceId"),
            if (o.isNull("outgoingSince")) null else o.getLong("outgoingSince"))
    }
    // Called under SyncEngine.lock. Do not reset the blocked flag during consent.
    fun enableOutgoing(e: Enrollment, since: Long) {
        require(since > 0 && e.outgoingSince == null)
        val value = JSONObject().put("token", e.token).put("scope", e.scope.toString())
            .put("started", e.started).put("deviceId", e.deviceId).put("outgoingSince", since)
        check(prefs.edit().putString("enrollment", encrypt(value.toString())).commit())
    }
    fun isBlocked() = prefs.getBoolean("blocked", false)
    fun block() { check(prefs.edit().putBoolean("blocked", true).commit()) }
    fun clear() { check(prefs.edit().clear().commit()) }
    companion object { private const val KEY = "crm_call_sync_v1" }
}
