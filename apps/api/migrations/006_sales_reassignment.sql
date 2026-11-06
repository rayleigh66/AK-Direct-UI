-- Phase 4B-04 P0-01: sales access follows the customer company's CURRENT
-- assigned salesperson, while orders.assigned_sales_user_id remains the
-- immutable submission-time audit snapshot.
--
-- Pending sales notifications addressed to a former owner are cancelled so a
-- future sender cannot deliver them to someone who no longer owns the company.

ALTER TABLE order_notifications
  DROP CONSTRAINT IF EXISTS order_notifications_status_check;

ALTER TABLE order_notifications
  ADD CONSTRAINT order_notifications_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'cancelled'));

ALTER TABLE order_notifications
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE INDEX IF NOT EXISTS order_notifications_sales_pending_idx
  ON order_notifications(company_id, internal_user_id, status)
  WHERE audience = 'sales';

UPDATE order_notifications n
SET status = 'cancelled', cancelled_at = now()
FROM customer_companies c
WHERE n.audience = 'sales'
  AND n.status = 'pending'
  AND c.id = n.company_id
  AND n.internal_user_id IS DISTINCT FROM c.assigned_sales_user_id;

INSERT INTO system_metadata (key, value)
VALUES ('schema_version', '4b04.1')
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, updated_at = now();
