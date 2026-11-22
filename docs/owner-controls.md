# KotaLabs owner controls (opt-in)

These controls are separate from client admin accounts and are not linked from
client navigation. The URL is not a secret or an authorization mechanism. This
is one control panel per CRM installation, not a centralized multi-client portal.
Use only with the client's knowledge and contractual agreement. Suspension does
not delete data or prevent access to information already downloaded or displayed.

## Test setup only, after approval

1. Back up the **test** database. Confirm backend and database identity, then
   apply migrations including `0003_owner_controls.sql` using the repository's
   migration runner in an environment with development dependencies. The
   production Docker image does not contain `tsx`; do not run the runner there.
   Do not modify production until separately approved.
2. Generate a unique random 256-bit key securely (`openssl rand -hex 32`) and
   set `OWNER_CONTROL_KEY` privately in the test backend's hosting settings.
   Never paste it into chat, a URL, source control, logs or client documentation.
   Store it in a password manager. Do not reuse this key for other installations.
3. Deploy the matching backend and set `OWNER_CONTROLS_ENABLED=true` in the test
   backend, then deploy the matching web preview. Verify the preview points only
   at the test backend. If enabled without a valid key the backend refuses to
   start. If enabled without the migration normal API access fails closed.
4. On the preview visit `/kotalabs-owner`, enter the key and test status, suspend,
   resume, block and unblock with disposable test accounts and consenting test
   phones. The key lives only in the browser page memory until locked or closed.
   It grants full owner control to whoever has it. Use HTTPS and a trusted device.

The controls only operate while `OWNER_CONTROLS_ENABLED=true`. Turning the flag
**off** bypasses existing suspension and account blocks. Restrict hosting and DB
access accordingly; removing the key while enabled prevents backend startup. To
rotate the key, update it privately and restart; old owner keys immediately stop
working. Do not expose owner credentials to the client. The current single shared
key is a high-entropy bearer credential, not an individual account, does not have
MFA or per-person audit attribution, and the process-local rate limiter is not a
complete distributed attack defence. Before production, add a separately secured
MFA-enabled identity/access layer and shared edge rate limiting, and review access
and logs. The key must never appear in requests' URLs or logs.

## Behaviour and limitations

- Suspension blocks regular `/api/auth` and `/api/v1` requests including device
  uploads, with HTTP 503 so existing Android apps retain their queue and retry.
  Health endpoints and the authenticated owner API remain available. Offline
  Android phones may continue collecting calls subject to existing consent; queue
  durability, available storage, OS restrictions and retry delays still apply.
- Blocking an admin is independent of client user status and survives changes to
  the user's role. It revokes their refresh tokens and blocks authenticated web
  and device requests; other admins cannot remove the owner block. Unblocking
  doesn't change a separately disabled user status. Existing unexpired access
  tokens can work again after unblocking; revoked refresh tokens cannot.
- Requests already in flight when suspended/blocked may finish. Previously
  displayed/exported data cannot be recalled. Website code and health remain
  publicly accessible, but protected CRM data APIs are blocked.
- Audit rows record action, target ID and time, not secrets; all owner actions
  share the same identity. There is no client notification or automated billing.
  Arrange notice and data-access rights with the client.
- No real-phone, adversarial security, production or multi-instance tests have
  been completed for this feature. Backups, rollback and credential rotation
  remain necessary before rollout.
