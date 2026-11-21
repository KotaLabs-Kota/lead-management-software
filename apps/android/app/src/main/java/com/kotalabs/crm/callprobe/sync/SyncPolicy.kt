package com.kotalabs.crm.callprobe.sync

import java.nio.charset.StandardCharsets
import java.util.UUID

/**
 * Pure sync policy for the future call-sync app. This is deliberately not wired
 * into the local-only diagnostic: no permission, network or background work is
 * performed by this class. Persistence and enrollment must precede activation.
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
