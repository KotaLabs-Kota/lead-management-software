plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val syncOrigin = providers.environmentVariable("CRM_SYNC_ORIGIN").orNull?.trim()?.takeIf { it.isNotEmpty() }
    ?: "https://lead-management-software-eight.vercel.app"
val originUri = java.net.URI(syncOrigin)
require(originUri.scheme == "https" && !originUri.host.isNullOrBlank() && originUri.userInfo == null &&
    originUri.rawQuery == null && originUri.rawFragment == null && originUri.path.isNullOrEmpty()) {
    "CRM_SYNC_ORIGIN must be an HTTPS origin without credentials, path, query, or fragment"
}

android {
    buildFeatures { buildConfig = true }
    namespace = "com.kotalabs.crm.callsync"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.kotalabs.crm.callsync"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-test"
        buildConfigField("String", "CRM_SYNC_ORIGIN", "\"$syncOrigin\"")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies { testImplementation("junit:junit:4.13.2") }
