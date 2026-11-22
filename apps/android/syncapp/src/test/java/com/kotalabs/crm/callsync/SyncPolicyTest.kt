package com.kotalabs.crm.callsync

import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class SyncPolicyTest {
    @Test fun eventIdsAreStableAndScopedWithoutPhoneNumbers() {
        val device = UUID.randomUUID()
        val event = SyncPolicy.eventId(device, 41, 1700000000000)
        assertEquals(event, SyncPolicy.eventId(device, 41, 1700000000000))
        assertNotEquals(event, SyncPolicy.eventId(UUID.randomUUID(), 41, 1700000000000))
        assertNotEquals(event, SyncPolicy.eventId(device, 42, 1700000000000))
        assertNotEquals(event, SyncPolicy.eventId(device, 41, 1700000000001))
        assertEquals(3, event.version())
    }

    @Test fun invalidCallIdentityIsRejected() {
        val device = UUID.randomUUID()
        assertThrows(IllegalArgumentException::class.java) { SyncPolicy.eventId(device, -1, 1) }
        assertThrows(IllegalArgumentException::class.java) { SyncPolicy.eventId(device, 1, 0) }
    }

    @Test fun outgoingCallsRequireConsentAndAreNotBackfilled() {
        assertFalse(SyncPolicy.outgoingAllowed(1000L, null))
        assertFalse(SyncPolicy.outgoingAllowed(999L, 1000L))
        assertTrue(SyncPolicy.outgoingAllowed(1000L, 1000L))
        assertTrue(SyncPolicy.outgoingAllowed(1001L, 1000L))
    }

    @Test fun contactNamesRequireSeparateConsentAndNeverBackfill() {
        assertFalse(SyncPolicy.contactNameAllowed(1000L, 0L))
        assertFalse(SyncPolicy.contactNameAllowed(999L, 1000L))
        assertTrue(SyncPolicy.contactNameAllowed(1000L, 1000L))
    }

    @Test fun noPendingCallsMeansNoRequestAndBatchesAreBounded() {
        assertTrue(SyncPolicy.nextBatch(emptyList()).isEmpty())
        val calls = List(120) { UUID.randomUUID() }
        assertEquals(calls.take(100), SyncPolicy.nextBatch(calls + calls[0]))
        assertEquals(listOf(calls[0]), SyncPolicy.nextBatch(listOf(calls[0], calls[0])))
    }

    @Test fun onlyAcknowledgedSentEventsAreRemoved() {
        val sent = List(3) { UUID.randomUUID() }
        val unrelated = UUID.randomUUID()
        assertEquals(setOf(sent[0], sent[2]), SyncPolicy.acknowledged(sent, listOf(sent[0], sent[2], unrelated)))
        assertTrue(SyncPolicy.acknowledged(sent, emptyList()).isEmpty())
    }
}
