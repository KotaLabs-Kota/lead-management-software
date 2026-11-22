package com.kotalabs.crm.callsync

import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * Pure batching, acknowledgement and ID policy used by the call sync app.
 */
internal object SyncPolicy {
    // Work is best effort: Android may defer background jobs beyond this delay.
    const val FALLBACK_DELAY_MILLIS = 5 * 60 * 1000L
    const val MAX_BATCH_SIZE = 100 // Backend accepts at most 500.

    /**
     * Registration scope is a random UUID that must be persisted securely before
     * reading calls. An Android row ID alone isn't unique across devices/resets.
     * The ID contains no phone number and stays stable across retries.
     */
    fun eventId(registrationScope: UUID, callLogRowId: Long, startedAtMillis: Long): UUID {
        require(callLogRowId >= 0 && startedAtMillis > 0)
        val name = "kotalabs-call-v1:$registrationScope:$callLogRowId:$startedAtMillis"
        return UUID.nameUUIDFromBytes(name.toByteArray(StandardCharsets.UTF_8))
    }

    /** Previously enrolled devices require fresh consent; never backfill outgoing calls. */
    fun outgoingAllowed(startedAtMillis: Long, outgoingSince: Long?): Boolean =
        outgoingSince != null && startedAtMillis >= outgoingSince

    /** Names are captured only for calls started after separate contact consent. */
    fun contactNameAllowed(startedAtMillis: Long, consentSince: Long): Boolean =
        consentSince > 0 && startedAtMillis >= consentSince

    /** Select only pending items; an empty list means no HTTP request at all. */
    fun nextBatch(pending: List<UUID>): List<UUID> = pending.distinct().take(MAX_BATCH_SIZE)

    /**
     * Remove only positively acknowledged event IDs from the sent batch. Failed,
     * absent, or unexpected IDs must not cause other queued calls to be dropped.
     * Persistent deletion must be atomic with recording the acknowledgement.
     */
    fun acknowledged(sent: List<UUID>, createdOrDuplicate: Collection<UUID>): Set<UUID> =
        sent.toSet().intersect(createdOrDuplicate.toSet())
}
