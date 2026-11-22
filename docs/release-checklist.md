# CRM production-readiness checklist

This is a checklist, not a claim of completed testing or approval. Never point a
new test build at live customer data. Production rollout and purchases require
explicit owner approval. Keep test and production databases, API credentials,
frontend deployments and Android app origins separate.

## Security and account handling

- [ ] Rotate previously exposed database credentials and JWT signing secrets in
  each affected environment. Set new values privately in the hosting dashboards;
  never put credentials in chat, screenshots, source control or issue reports.
  Plan a coordinated restart. Rotating the JWT secret signs out web sessions.
- [ ] Test the session-hardening deployment: existing web access tokens without
  the new password-version claim are rejected, so users may need to sign out and
  log in again. Password changes/reset now invalidate existing web access tokens
  immediately and revoke refresh tokens; Android device tokens are separate and
  must be revoked on the Devices page if a phone is lost or compromised.
  Logging out alone revokes the refresh token; an already issued access token may
  remain usable until its expiry. Access tokens are currently stored in browser
  localStorage; a security review should evaluate XSS exposure and safer session
  storage before production. The change does not replace a security audit.
- [ ] Run `npm audit`, backend/web typechecks, tests and builds on the release
  commit. The backend Dockerfile uses the root workspace lockfile. Recheck for
  new advisories; an audit result is not a security guarantee.
- [ ] Confirm HTTPS, exact CORS origins, no debug credentials, least-privilege
  users, admin access, device revocation, and secret management. Inspect logs for
  sensitive data without copying credentials into tickets or chat.

## Phone testing on the actual models and SIMs

- [ ] For every model/Android version, record device, version and test date; do
  not record real contact names or phone numbers in shared test notes.
- [ ] With informed consent and a test backend, verify incoming, outgoing,
  missed and call-waiting calls against the native log; a call not recorded or
  identified by Android/carrier cannot be synced. Check number, direction, time,
  duration where available, phone identity, lead link, and returning contacts.
- [ ] Test contact-name consent/denial/revocation, saved and unsaved numbers,
  different names on different phones, and no overwrite of CRM-entered names.
- [ ] Test offline calls, delayed retry, duplicate prevention, app reboot,
  force-stop/reopen, battery optimization, connectivity failures, device
  revocation and user disablement. Android may delay or prevent background jobs;
  five minutes is best effort, not a delivery guarantee.
- [ ] Use a stable, protected release signing key and agree an installation and
  update/distribution method before production. CI debug keys are ephemeral.
  Uninstalling can erase pending calls and device registration; sync the queue,
  confirm revocation and plan recovery before replacing an installation. Check
  Google Play permission eligibility if Play distribution is contemplated.

## Database, operations and rollout

- [ ] Agree the six-month retention scope (calls, leads, notifications, activity,
  backups, or other records), date rules, deletion dependencies, legal hold and
  recovery expectations. **Automatic retention deletion is not implemented.**
- [ ] Choose and test a suitable encrypted backup and restore procedure. Verify
  it against a separate test database; free-tier restore windows may not meet
  business needs. Set monitoring for database storage, compute, API health,
  failures and cost alerts, and define a support contact.
- [ ] Confirm whether 2,000 calls/day is total or per phone, concurrent usage,
  growth and six-month data volume. Load-test representative data and exports;
  do not assume free-tier limits or cost estimates guarantee production capacity.
- [ ] Before an approved rollout, back up the intended live database, confirm
  its identity and migration history, apply migrations, deploy the backend, set
  required feature flags, deploy the matching Vercel frontend, and test login,
  authorization, PDF, notifications and device sync. See README for the password
  notification migration; production Docker does not include the migration CLI.
  Prepare a tested rollback plan, including database compatibility and whether
  already queued Android calls will remain compatible. Do not merge the PR or
  enable test flags on live until approved.
- [ ] Keep each client's data and credentials isolated. This application is not
  designed or audited as a shared multi-tenant system.
