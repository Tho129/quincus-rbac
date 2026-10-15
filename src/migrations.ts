import { Client, type Pool, type PoolClient } from "pg";
import type { Queryable } from "./storage/pg";

/**
 * Schema migrations, applied in order and recorded in
 * `rbac.schema_migrations`. Append new entries; never edit a shipped one.
 * Requires Postgres 13+ (`gen_random_uuid()` is built in).
 */
export const MIGRATIONS: readonly { version: string; sql: string }[] = [
  {
    version: "001_init",
    sql: `
      CREATE TABLE rbac.roles (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   text NOT NULL,
        name        text NOT NULL,
        description text NOT NULL DEFAULT '',
        is_system   boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT roles_tenant_id_id_key UNIQUE (tenant_id, id)
      );
      CREATE UNIQUE INDEX roles_tenant_name_key ON rbac.roles (tenant_id, lower(name));

      -- tenant_id is repeated on every child table and part of the foreign key,
      -- so a row can only ever point at a role of its own tenant.
      CREATE TABLE rbac.role_permissions (
        tenant_id  text NOT NULL,
        role_id    uuid NOT NULL,
        permission text NOT NULL,
        PRIMARY KEY (role_id, permission),
        FOREIGN KEY (tenant_id, role_id) REFERENCES rbac.roles (tenant_id, id) ON DELETE CASCADE
      );

      CREATE TABLE rbac.user_roles (
        tenant_id  text NOT NULL,
        user_id    text NOT NULL,
        role_id    uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, user_id, role_id),
        FOREIGN KEY (tenant_id, role_id) REFERENCES rbac.roles (tenant_id, id) ON DELETE CASCADE
      );
      CREATE INDEX user_roles_role_idx ON rbac.user_roles (role_id);

      CREATE TABLE rbac.group_roles (
        tenant_id  text NOT NULL,
        group_name text NOT NULL,
        role_id    uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, group_name, role_id),
        FOREIGN KEY (tenant_id, role_id) REFERENCES rbac.roles (tenant_id, id) ON DELETE CASCADE
      );
      CREATE INDEX group_roles_role_idx ON rbac.group_roles (role_id);
    `,
  },
];

/**
 * Applies pending migrations on a connection the caller already holds inside
 * a transaction. Concurrent deploys serialise on a transaction-level advisory
 * lock. Returns the versions applied.
 */
export async function applyMigrations(conn: Queryable): Promise<string[]> {
  await conn.query(`SELECT pg_advisory_xact_lock(hashtext('quincus-rbac-migrate'))`);
  await conn.query(`CREATE SCHEMA IF NOT EXISTS rbac`);
  await conn.query(
    `CREATE TABLE IF NOT EXISTS rbac.schema_migrations (
       version    text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const { rows } = await conn.query(`SELECT version FROM rbac.schema_migrations`);
  const done = new Set((rows as { version: string }[]).map((r) => r.version));

  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    await conn.query(m.sql);
    await conn.query(`INSERT INTO rbac.schema_migrations (version) VALUES ($1)`, [m.version]);
    applied.push(m.version);
  }
  return applied;
}

/**
 * Brings the `rbac` schema up to date in one transaction. Accepts a
 * connection string or a pg `Pool`. Safe to run on every deploy.
 */
export async function migrate(db: string | Pool): Promise<string[]> {
  let client: Client | PoolClient;
  let release: () => Promise<void>;
  if (typeof db === "string") {
    const c = new Client({ connectionString: db });
    await c.connect();
    client = c;
    release = () => c.end();
  } else {
    const c = await db.connect();
    client = c;
    release = async () => c.release();
  }

  try {
    await client.query("BEGIN");
    const applied = await applyMigrations(client);
    await client.query("COMMIT");
    return applied;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await release();
  }
}
