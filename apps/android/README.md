# Stage 4: Android call-history feasibility probe

A separate experimental sync app now exists under [`syncapp/`](syncapp/README.md). This page describes the original probe only.

This is **not** the CRM sync app. It is an opt-in, foreground-only diagnostic for real Android phones (Android 8 / API 26 or newer). It reads at most the 50 most recent entries from the phone's call log when the tester taps Refresh, and shows their type, local time, duration, masked number, and local eligibility reason. It also asks for Phone permission to inspect whether Android identifies each account as a SIM. It does not upload anything, create leads, record audio, continuously track calls, or write call history to its own storage. It cannot access a call the phone did not receive or record. WhatsApp call capture is not supported.

## Build and install

1. Install Android Studio with JDK 17, Android SDK Platform 35 and Android SDK Build Tools. Open **`apps/android`** as a project (not the repository root). Let Gradle sync; the first sync downloads Gradle and Android dependencies.
2. Connect an Android phone with USB debugging enabled and select it in Android Studio, or use **Build > Build APK(s)** to create `app/build/outputs/apk/debug/app-debug.apk`. Install only on a phone whose owner has consented to this test.
3. Open **CRM Call Test**, tap **Allow access and refresh calls**, and explicitly allow Call logs and Phone access. Android Settings can be used to revoke it at any time. Numbers on screen are masked; don't share call details or screenshots without consent.
4. If the button is denied permanently, enable Call logs and Phone under Android Settings > Apps > CRM Call Test > Permissions. The app has no internet permission.

Build from a terminal in this directory: `./gradlew :app:assembleDebug` (on Windows: `gradlew.bat :app:assembleDebug`). The project needs network access to Google's Android Maven and the Gradle distribution service. No keystore or release signing is configured.

## Real-device test matrix

Use consenting participants and test numbers, not customer data. Record the phone model, Android version, SIM/carrier, call waiting setting, date, whether the app has permission, and *only masked* test results. Tap Refresh after each case:

- Answer an incoming call; verify type, approximate time, and duration.
- Let an incoming call ring without answering; verify it appears as missed and its time.
- While on a call, have another person call; test both accepting and missing the waiting call. Compare with the native Phone app's call history. Repeat with call waiting disabled if the carrier permits it. If the carrier or phone does not deliver/log a call, this probe cannot capture it.
- Make two calls close together and verify both show separately. Check dual-SIM behavior where applicable; this probe does **not** identify the SIM slot.
- Deny then grant permission, revoke in Settings, and check the app doesn't display old results after revocation.
- Turn internet off for a call, turn it back on and refresh: the local history should still be visible. This is **not** an offline CRM-sync test.

Run on each staff device. Restricted/private caller numbers may be unavailable. A provider may classify rejected/busy calls differently; never infer a missed call when no record exists. Manufacturer battery restrictions and ongoing background detection are **not** tested by this foreground probe.

## Original next-stage plan (see syncapp for work in progress)

Only after the real-device feasibility test: design a consent-based background sync, stable event IDs and retry/deduplication, secure device enrollment, and a backend transaction that creates an open lead for a new number, links calls to an existing open lead, and tags a new lead as a returning contact when matching prior closed leads. Define history visibility under employee access controls and test races, private numbers, spam, closed leads and duplicate deliveries. The backend can optionally create leads for device calls when explicitly enabled; it defaults off. This diagnostic does not change that behavior.

`READ_CALL_LOG` is a sensitive Android permission. Google Play restricts its use; eligibility and distribution approach must be checked before any public release. Do not request unnecessary permissions or use Accessibility workarounds.

## GitHub Actions test APK

The **Android call feasibility build** workflow builds a debug APK when Android files change or when manually triggered. A successful run publishes the `CRM-call-feasibility-debug` artifact for seven days; downloading it requires access to the repository. Extract the ZIP and transfer the APK securely to the consenting test phone. A debug APK is for private feasibility testing, not production distribution or a Play Store release. The workflow must run successfully before an artifact exists.
