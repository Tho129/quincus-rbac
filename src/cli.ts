#!/usr/bin/env node
import { seedTenantAdmin } from "./admin";
import { migrate } from "./migrations";
import { createPool, pgStorage } from "./storage/pg";

const USAGE = `Usage:
  quincus-rbac migrate     [--database-url <url>]
  quincus-rbac grant-admin --tenant <tenantId> --user <userId> [--database-url <url>]

The database URL defaults to $DATABASE_URL.`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  const databaseUrl = flags["database-url"] ?? process.env.DATABASE_URL;

  if (!command || command === "help" || command === "--help") {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if (!databaseUrl) {
    console.error("quincus-rbac: no database URL (pass --database-url or set DATABASE_URL)");
    return 1;
  }

  if (command === "migrate") {
    const applied = await migrate(databaseUrl);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "rbac schema is up to date");
    return 0;
  }

  if (command === "grant-admin") {
    const tenant = flags.tenant;
    const user = flags.user;
    if (!tenant || !user) {
      console.error(USAGE);
      return 1;
    }
    const pool = createPool(databaseUrl, { poolMax: 1 });
    try {
      const role = await seedTenantAdmin(pgStorage(pool), tenant, user);
      console.log("Granted role %s (%s) to user %s in tenant %s", JSON.stringify(role.name), role.id, JSON.stringify(user), JSON.stringify(tenant));
    } finally {
      await pool.end();
    }
    return 0;
  }

  console.error("quincus-rbac: unknown command %s\n%s", JSON.stringify(command), USAGE);
  return 1;
}

function parseFlags(args: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else out[arg.slice(2)] = args[++i];
  }
  return out;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error("quincus-rbac: %s", err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
