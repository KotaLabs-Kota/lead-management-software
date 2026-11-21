package com.kotalabs.crm.callsync

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

/** Only encrypted payloads and opaque IDs are stored; sent IDs are retained for deduplication. */
internal class Queue(context: Context, private val secure: SecureStore) : SQLiteOpenHelper(context, "call-sync.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE calls (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL, retry_at INTEGER NOT NULL DEFAULT 0)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = error("Unexpected queue migration")
    fun add(id: String, event: JSONObject) {
        val values = ContentValues().apply {
            put("id", id); put("payload", secure.encrypt(event.toString())); put("state", "pending")
        }
        writableDatabase.insertWithOnConflict("calls", null, values, SQLiteDatabase.CONFLICT_IGNORE)
    }
    fun contains(id: String): Boolean = readableDatabase.rawQuery("SELECT 1 FROM calls WHERE id=?", arrayOf(id)).use { it.moveToFirst() }
    fun pending(): List<Pair<String, JSONObject>> {
        val items = mutableListOf<Pair<String, JSONObject>>()
        readableDatabase.rawQuery("SELECT id,payload FROM calls WHERE state='pending' AND retry_at <= ? ORDER BY rowid LIMIT 100", arrayOf(System.currentTimeMillis().toString())).use {
            while (it.moveToNext()) items.add(it.getString(0) to JSONObject(secure.decrypt(it.getString(1))))
        }
        return items
    }
    fun acknowledge(ids: Collection<String>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (id in ids) db.execSQL("UPDATE calls SET state='sent', payload=NULL WHERE id=? AND state='pending'", arrayOf(id))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun defer(ids: Collection<String>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            // Isolate unaccepted items so they cannot block subsequent calls.
            for (id in ids) db.execSQL("UPDATE calls SET retry_at=? WHERE id=? AND state='pending'", arrayOf(System.currentTimeMillis() + 60 * 60 * 1000L, id))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    fun count(state: String): Int = readableDatabase.rawQuery("SELECT COUNT(*) FROM calls WHERE state=?", arrayOf(state)).use { it.moveToFirst(); it.getInt(0) }
    fun clearAll() { writableDatabase.delete("calls", null, null) }
}
