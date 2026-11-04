-- Phase 4B-02 fix: the responsible salesperson may perform authorized sales
-- writes for their own assigned customers. Data-scope checks in the API still
-- limit a sales user to companies assigned to them. The separate `sales.write`
-- grant remains the additional authorization required for administrators, who
-- otherwise only supervise sales data (sales.read_all).
--
-- Additive migration: 002_auth_rbac.sql is already applied and checksum-frozen,
-- so this grant is introduced here instead of editing the applied file.

INSERT INTO role_permissions (role_id, permission_id) VALUES ('sales', 'sales.write')
ON CONFLICT DO NOTHING;
