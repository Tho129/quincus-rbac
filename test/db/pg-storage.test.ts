import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { MIGRATIONS, applyMigrations } from "../../src/migrations";
import { pgStorage } from "../../src/storage/pg";
import { storageContract } from "../support/storage-contract";

/**
 * Runs the storage contract against real Postgres. Every case runs in its own
 * transaction that is rolled back, migrations included — nothing is left in
 * the database. Skips when DATABASE_URL is unset.
 */
const url = process.env.DATABASE_URL;

if (!url) {
  test("pgStorage (skipped: DATABASE_URL not set)", { skip: true }, () => {});
} else {
  const pool = new Pool({ connectionString: url, max: 2 });
  after(() => pool.end());

  const begin = async (): Promise<PoolClient> => {
    const client = await pool.connect();
    await client.query("BEGIN");
    await applyMigrations(client);
    return client;
  };
  const rollback = async (client: PoolClient) => {
    await client.query("ROLLBACK");
    client.release();
  };

  storageContract("pgStorage", async () => {
    const client = await begin();
    return { storage: pgStorage(client), teardown: () => rollback(client) };
  });

  test("applyMigrations is idempotent and records every version", async () => {
    const client = await begin();
    try {
      assert.deepEqual(await applyMigrations(client), [], "second run applies nothing");
      const { rows } = await client.query<{ version: string }>(
        "SELECT version FROM rbac.schema_migrations ORDER BY version",
      );
      assert.deepEqual(
        rows.map((r) => r.version),
        MIGRATIONS.map((m) => m.version),
      );
    } finally {
      await rollback(client);
    }
  });
}
