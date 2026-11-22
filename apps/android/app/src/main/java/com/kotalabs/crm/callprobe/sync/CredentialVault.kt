package com.kotalabs.crm.callprobe.sync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/**
 * Storage primitive for future enrollment. Not wired into the diagnostic app.
 * Backups are disabled in the app manifest; neither token nor call data should
 * ever be written to logs. Failure to decrypt is surfaced to the caller, never
 * silently replaced with a different identity (which could duplicate calls).
 */
internal class CredentialVault(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("call_sync_vault", Context.MODE_PRIVATE)
    private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    data class Credentials(val deviceToken: String, val registrationScope: UUID)

    @Synchronized
    fun save(credentials: Credentials) {
        require(credentials.deviceToken.startsWith("dvc_"))
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
        val payload = JSONObject().put("token", credentials.deviceToken)
            .put("scope", credentials.registrationScope.toString()).toString()
        val ciphertext = cipher.doFinal(payload.toByteArray(StandardCharsets.UTF_8))
        val encrypted = JSONObject()
            .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
        check(preferences.edit().putString(ENTRY, encrypted.toString()).commit()) { "Could not save device credentials" }
    }

    @Synchronized
    fun load(): Credentials? {
        val encoded = preferences.getString(ENTRY, null) ?: return null
        val encrypted = JSONObject(encoded)
        val iv = Base64.decode(encrypted.getString("iv"), Base64.NO_WRAP)
        val ciphertext = Base64.decode(encrypted.getString("data"), Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, iv))
        val payload = JSONObject(String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8))
        val token = payload.getString("token")
        require(token.startsWith("dvc_"))
        return Credentials(token, UUID.fromString(payload.getString("scope")))
    }

    /** Local removal does not revoke the server token; an admin must revoke it. */
    @Synchronized
    fun clear() {
        check(preferences.edit().remove(ENTRY).commit()) { "Could not clear device credentials" }
    }

    private fun key(create: Boolean): SecretKey {
        val existing = store.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing
        check(create) { "Device encryption key is unavailable; re-enrollment is required" }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEY_ALIAS = "crm_call_sync_credentials_v1"
        const val ENTRY = "credentials_v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
