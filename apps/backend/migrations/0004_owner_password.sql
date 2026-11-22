-- Optional owner password login. Passwords are stored only as salted scrypt hashes.
CREATE TABLE owner_password_login (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE owner_control_audit DROP CONSTRAINT owner_control_audit_action_check;
ALTER TABLE owner_control_audit ADD CONSTRAINT owner_control_audit_action_check
  CHECK (action IN ('SERVICE_SUSPENDED', 'SERVICE_RESUMED', 'ADMIN_BLOCKED', 'ADMIN_UNBLOCKED', 'PASSWORD_SET'));
