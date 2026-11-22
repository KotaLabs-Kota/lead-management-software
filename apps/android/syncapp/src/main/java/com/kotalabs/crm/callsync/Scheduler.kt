package com.kotalabs.crm.callsync

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.CallLog
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal object Scheduler {
    private const val TIMER = 6301
    private const val CHANGES = 6302
    private const val MANUAL = 6303
    private fun service(context: Context) = ComponentName(context, SyncJob::class.java)
    private fun scheduler(context: Context) = context.getSystemService(JobScheduler::class.java)
    fun ensure(context: Context) {
        val jobs = scheduler(context).allPendingJobs.map { it.id }.toSet()
        if (TIMER !in jobs) timer(context)
        if (CHANGES !in jobs) changes(context)
    }
    private fun timer(context: Context) {
        // One-off best-effort fallback: Android can defer it (especially in Doze).
        scheduler(context).schedule(JobInfo.Builder(TIMER, service(context)).setMinimumLatency(5 * 60 * 1000L).setPersisted(true).build())
    }
    private fun changes(context: Context) {
        scheduler(context).schedule(JobInfo.Builder(CHANGES, service(context))
            .addTriggerContentUri(JobInfo.TriggerContentUri(CallLog.Calls.CONTENT_URI, JobInfo.TriggerContentUri.FLAG_NOTIFY_FOR_DESCENDANTS))
            .setTriggerContentUpdateDelay(10_000L).setTriggerContentMaxDelay(60_000L).build())
    }
    fun manual(context: Context) {
        scheduler(context).schedule(JobInfo.Builder(MANUAL, service(context)).setMinimumLatency(1).build())
    }
    fun finished(context: Context, id: Int) {
        if (id == TIMER) timer(context)
        if (id == CHANGES) changes(context)
    }
    fun cancel(context: Context) { listOf(TIMER, CHANGES, MANUAL).forEach { scheduler(context).cancel(it) } }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        try { if (SecureStore(context).load() != null) Scheduler.ensure(context) } catch (_: Exception) { }
    }
}

class SyncJob : JobService() {
    private val executor = Executors.newSingleThreadExecutor()
    private val stopped = mutableMapOf<Int, AtomicBoolean>()
    override fun onStartJob(params: JobParameters): Boolean {
        val flag = AtomicBoolean(false)
        synchronized(stopped) { stopped[params.jobId] = flag }
        executor.execute {
            try { SyncEngine.run(applicationContext) }
            catch (_: Exception) {
                getSharedPreferences("sync_status", MODE_PRIVATE).edit().putString("status", "Could not read or securely store call data. Open the app and check permissions.").apply()
            }
            if (!flag.get()) {
                jobFinished(params, false)
                synchronized(SyncEngine.lock) {
                    try { if (SecureStore(applicationContext).load() != null) Scheduler.finished(applicationContext, params.jobId) } catch (_: Exception) { }
                }
            }
            synchronized(stopped) { if (stopped[params.jobId] === flag) stopped.remove(params.jobId) }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean {
        synchronized(stopped) { stopped[params.jobId]?.set(true) }
        return true
    }
    override fun onDestroy() { executor.shutdown(); super.onDestroy() }
}
