-- Metadata only: never store password values, hashes, or tokens in notifications.
CREATE TABLE password_change_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('SELF_CHANGE', 'ADMIN_RESET')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_change_notifications_created_idx
  ON password_change_notifications (created_at DESC, id DESC);

-- Each administrator has independent read status.
CREATE TABLE password_notification_reads (
  notification_id uuid NOT NULL REFERENCES password_change_notifications(id) ON DELETE CASCADE,
  admin_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, admin_user_id)
);
CREATE INDEX password_notification_reads_admin_idx ON password_notification_reads (admin_user_id, notification_id);
