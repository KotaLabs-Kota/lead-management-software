-- Owner controls do not delete or modify client records.
CREATE TABLE owner_service_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  suspended boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO owner_service_control (singleton) VALUES (true);

CREATE TABLE owner_blocked_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only metadata: never record the owner key, passwords or customer data.
CREATE TABLE owner_control_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('SERVICE_SUSPENDED', 'SERVICE_RESUMED', 'ADMIN_BLOCKED', 'ADMIN_UNBLOCKED')),
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
