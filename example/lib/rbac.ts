import { createRbac, memoryStorage, type RbacStorage, type TenantUser } from "@quincusdev/rbac";
import { cookies } from "next/headers";

/**
 * DEMO ONLY. Identity comes from a plain cookie set by the "Sign in as"
 * switcher — no verification at all. A real app verifies a token or session
 * in getUser (see the package README).
 */
export const DEMO_COOKIE = "rbac_demo_user";

export interface DemoUser extends TenantUser {
  tenantId: string;
  groups: string;
}

export const DEMO_USERS: DemoUser[] = [
  { id: "alice", name: "Alice Nguyen", email: "alice@acme.test", tenantId: "acme", groups: "" },
  { id: "bob", name: "Bob Tran", email: "bob@acme.test", tenantId: "acme", groups: "" },
  { id: "carol", name: "Carol Le", email: "carol@acme.test", tenantId: "acme", groups: "[Finance, Staff]" },
  { id: "dave", name: "Dave Pham", email: "dave@globex.test", tenantId: "globex", groups: "Staff" },
];

export function demoUser(id: string | undefined): DemoUser | undefined {
  return DEMO_USERS.find((u) => u.id === id);
}

// One store per process, shared by route handlers and server components.
const demo = globalThis as unknown as { __rbacDemo?: { storage: RbacStorage; seeded?: Promise<void> } };
demo.__rbacDemo ??= { storage: memoryStorage() };
const state = demo.__rbacDemo;

/** Seeds once, on the first request (after `rbac` exists). */
function ensureSeeded(): Promise<void> {
  state.seeded ??= seed();
  return state.seeded;
}

export const rbac = createRbac({
  permissions: {
    order: {
      label: "Orders",
      description: "Customer orders and their delivery details",
      actions: {
        view: { label: "View orders", description: "See the orders list and order details" },
        create: "Create orders",
        edit: { label: "Edit orders", description: "Change quantities, dates and delivery points" },
        delete: "Delete orders",
      },
    },
    invoice: {
      label: "Invoices",
      actions: { view: "View invoices", approve: { label: "Approve invoices", description: "Approve an invoice for payment" } },
    },
    report: ["view", "export"],
  },
  storage: state.storage,
  getUser: async (req?: Request) => {
    await ensureSeeded();
    const id = req ? readCookie(req.headers.get("cookie"), DEMO_COOKIE) : (await cookies()).get(DEMO_COOKIE)?.value;
    const user = demoUser(id);
    return user ? { userId: user.id, tenantId: user.tenantId, groups: user.groups } : null;
  },
  listUsers: async (tenantId) =>
    DEMO_USERS.filter((u) => u.tenantId === tenantId).map(({ id, name, email, groups }) => ({ id, name, email, groups })),
});

/** Each tenant starts with an administrator; acme also gets a few roles to play with. */
async function seed() {
  const admin = rbac.admin;
  await admin.seedTenant("acme", "alice");
  await admin.seedTenant("globex", "dave");
  const ctx = { tenantId: "acme", actorId: "seed" };
  const viewer = await admin.createRole(ctx, {
    name: "Order viewer",
    description: "Read-only access to orders",
    permissions: ["order:view"],
  });
  const finance = await admin.createRole(ctx, {
    name: "Finance",
    description: "Invoices and reports",
    permissions: ["invoice:view", "invoice:approve", "report:view", "report:export"],
  });
  await admin.setUserRoles(ctx, "bob", [viewer.id]);
  await admin.setGroupRoles(ctx, "Finance", [finance.id]);
}

function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}
