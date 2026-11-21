package com.kotalabs.crm.callsync

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Fixed HTTPS origin prevents redirecting credentials to an untrusted endpoint. */
internal object Api {
    private val ORIGIN = BuildConfig.CRM_SYNC_ORIGIN
    class HttpError(val status: Int) : Exception("Server returned HTTP $status")

    fun get(path: String, token: String): JSONObject = request(path, null, token)
    fun post(path: String, body: JSONObject, token: String? = null): JSONObject = request(path, body, token)

    private fun request(path: String, body: JSONObject?, token: String?): JSONObject {
        require(path.startsWith("/api/"))
        val connection = URL(ORIGIN + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 20000
            connection.readTimeout = 60000 // Render free tier can take time to wake up.
            connection.requestMethod = if (body == null) "GET" else "POST"
            connection.doOutput = body != null
            if (body != null) connection.setRequestProperty("Content-Type", "application/json")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            if (status !in 200..299) throw HttpError(status)
            if (status == 204) return JSONObject()
            val text = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            return JSONObject(text)
        } finally { connection.disconnect() }
    }
}
