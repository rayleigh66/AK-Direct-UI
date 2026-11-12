import 'dotenv/config';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadMigrationDatabaseUrl } from '../config/env.js';

const { Client } = pg;
const USER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

export interface ProvisionRuntimeRoleInput {
  adminDatabaseUrl: string;
  runtimeUser: string;
  runtimePassword: string;
}

export interface ProvisionRuntimeRoleResult {
  runtimeUser: string;
  databaseName: string;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function databaseNameFromUrl(value: string): string {
  const parsed = new URL(value);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!name) throw new Error('Database URL must include a database name.');
  return name;
}

/**
 * Grants a least-privilege runtime role. The migrator/owner connection is used
 * only by the migration service; the API receives the runtime credentials.
 */
export async function provisionRuntimeRole(
  input: ProvisionRuntimeRoleInput
): Promise<ProvisionRuntimeRoleResult> {
  if (!USER_PATTERN.test(input.runtimeUser)) {
    throw new Error('RUNTIME_DB_USER must be a lowercase PostgreSQL identifier (max 63 chars).');
  }
  if (input.runtimePassword.length < 16) {
    throw new Error('RUNTIME_DB_PASSWORD must be at least 16 characters.');
  }

  const databaseName = databaseNameFromUrl(input.adminDatabaseUrl);
  const client = new Client({
    connectionString: input.adminDatabaseUrl,
    connectionTimeoutMillis: 5_000,
    application_name: 'aoking-direct-role-provisioner',
  });
  await client.connect();

  const role = quoteIdentifier(input.runtimeUser);
  const database = quoteIdentifier(databaseName);

  try {
    const currentUser = await client.query<{ current_user: string }>('SELECT current_user');
    if (currentUser.rows[0]?.current_user === input.runtimeUser) {
      throw new Error('RUNTIME_DB_USER must not be the migration/owner connection user.');
    }

    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
      input.runtimeUser,
    ]);
    const roleOptions = `LOGIN PASSWORD ${quoteLiteral(input.runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`;
    if (exists.rowCount === 0) {
      await client.query(`CREATE ROLE ${role} WITH ${roleOptions}`);
    } else {
      await client.query(`ALTER ROLE ${role} WITH ${roleOptions}`);
    }

    // Reset prior grants so a rerun cannot leave broader privileges behind.
    await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${role}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${role}`);
    await client.query(`REVOKE ALL ON SCHEMA public FROM ${role}`);
    await client.query(`REVOKE ALL ON DATABASE ${database} FROM ${role}`);

    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(
      `GRANT SELECT ON schema_migrations, system_metadata TO ${role}`
    );
    await client.query(
      `GRANT SELECT ON internal_users, roles, permissions, role_permissions,
        internal_user_roles, internal_user_permissions, customer_companies,
        customer_users, brands, brand_grants, auth_sessions, login_attempts,
        audit_logs TO ${role}`
    );
    await client.query(
      `GRANT INSERT, UPDATE ON customer_companies, customer_users, internal_users TO ${role}`
    );
    await client.query(`GRANT INSERT, DELETE ON brand_grants TO ${role}`);
    await client.query(`GRANT INSERT, UPDATE, DELETE ON auth_sessions TO ${role}`);
    await client.query(`GRANT INSERT, UPDATE, DELETE ON login_attempts TO ${role}`);
    await client.query(`GRANT INSERT ON audit_logs TO ${role}`);

    // Phase 4B-03 catalogue and inventory. There is deliberately no DELETE on
    // products, SKUs, images, series, tags or warehouses: the API only
    // publishes/unpublishes, deactivates or soft-removes. Inventory reserved
    // stock is not writable by the API at all (column-level grants).
    await client.query(
      `GRANT SELECT ON series_definitions, feature_tags, products, product_images,
        product_skus, product_feature_tags, warehouses, inventory_balances,
        inventory_movements, inventory_import_batches, inventory_import_rows TO ${role}`
    );
    await client.query(
      `GRANT INSERT, UPDATE ON series_definitions, feature_tags, products,
        product_images, product_skus, warehouses TO ${role}`
    );
    await client.query(`GRANT INSERT, DELETE ON product_feature_tags TO ${role}`);
    await client.query(
      `GRANT INSERT (sku_id, warehouse_id, on_hand, unsellable, version, updated_at, updated_by)
        ON inventory_balances TO ${role}`
    );
    await client.query(
      `GRANT UPDATE (on_hand, unsellable, version, updated_at, updated_by)
        ON inventory_balances TO ${role}`
    );
    await client.query(`GRANT INSERT ON inventory_movements TO ${role}`);
    await client.query(
      `GRANT INSERT, UPDATE (status, committed_at) ON inventory_import_batches TO ${role}`
    );
    await client.query(
      `GRANT INSERT (batch_id, row_number, sku_id, warehouse_id, on_hand_new,
        unsellable_new, on_hand_before, unsellable_before, reserved_before,
        version_before) ON inventory_import_rows TO ${role}`
    );
    await client.query(
      `GRANT SELECT ON inventory_import_commit_results TO ${role}`
    );
    await client.query(
      `GRANT INSERT ON inventory_import_commit_results TO ${role}`
    );

    // Phase 4B-04 shared cart and orders. Orders, order lines and status
    // history are never deleted by the API. Cart items are the only deletable
    // rows (remove line / clear cart). Idempotency and notification outbox rows
    // are immutable once written in this phase.
    await client.query(`GRANT SELECT ON order_statuses TO ${role}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE ON company_carts, order_sequences, orders TO ${role}`
    );
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON cart_items TO ${role}`
    );
    await client.query(
      `GRANT SELECT, INSERT ON order_items, order_idempotency,
        order_status_history, order_notifications TO ${role}`
    );
    // Reassignment invalidates unsent sales notifications for the former owner.
    await client.query(
      `GRANT UPDATE (status, cancelled_at) ON order_notifications TO ${role}`
    );
    // Product/price snapshots stay immutable; only the mutable quantity and its
    // derived reference line total may be updated on a pending order.
    await client.query(
      `GRANT UPDATE (quantity, line_reference_cents) ON order_items TO ${role}`
    );
    await client.query('COMMIT');

    return { runtimeUser: input.runtimeUser, databaseName };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  (async () => {
    try {
      const runtimeUser = process.env.RUNTIME_DB_USER?.trim();
      const runtimePassword = process.env.RUNTIME_DB_PASSWORD;
      if (!runtimeUser || !runtimePassword) {
        throw new Error('RUNTIME_DB_USER and RUNTIME_DB_PASSWORD are required.');
      }
      const result = await provisionRuntimeRole({
        adminDatabaseUrl: loadMigrationDatabaseUrl(),
        runtimeUser,
        runtimePassword,
      });
      console.log(
        `Runtime role provisioned: ${result.runtimeUser} (database ${result.databaseName}).`
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Runtime role provisioning failed.');
      process.exitCode = 1;
    }
  })();
}
