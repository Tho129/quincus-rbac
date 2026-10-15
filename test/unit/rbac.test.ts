import assert from "node:assert/strict";
import { test } from "node:test";
import { RbacError } from "../../src/errors";
import { createRbac } from "../../src/rbac";
import { memoryStorage } from "../../src/storage/memory";
import type { RbacChangeEvent, RbacUser } from "../../src/types";

type FakeReq = { user?: RbacUser | null };

function setup(cacheTtlMs = 60_000) {
  const events: RbacChangeEvent[] = [];
  const rbac = createRbac({
    permissions: { order: ["view", "edit"], invoice: ["view"] },
    storage: memoryStorage(),
    getUser: (req: FakeReq | undefined) => req?.user,
    onChange: (e) => {
      events.push(e);
    },
    cacheTtlMs,
  });
  const as = (userId: string, tenantId = "t1", groups?: unknown): FakeReq => ({ user: { userId, tenantId, groups } });
  const ctx = { tenantId: "t1", actorId: "admin" };
  return { rbac, as, ctx, events };
}

const isCode = (code: string) => (err: unknown) => err instanceof RbacError && err.code === code;

test("a user with no role has no permissions (least privilege)", async () => {
  const { rbac, as } = setup();
  const p = await rbac.identify(as("u1"));
  assert.deepEqual(p?.permissions, []);
  assert.equal(await rbac.can("order:view", as("u1")), false);
  await assert.rejects(rbac.require("order:view", as("u1")), isCode("forbidden"));
});

test("a signed-out caller is unauthenticated; can() is false", async () => {
  const { rbac } = setup();
  assert.equal(await rbac.identify({ user: null }), null);
  assert.equal(await rbac.can("order:view", undefined), false);
  await assert.rejects(rbac.require("order:view", { user: null }), isCode("unauthenticated"));
});

test("an identity without userId or tenantId is refused", async () => {
  const { rbac } = setup();
  await assert.rejects(rbac.identify({ user: { userId: "u1", tenantId: " " } }), isCode("unauthenticated"));
  await assert.rejects(rbac.identify({ user: { userId: "", tenantId: "t1" } }), isCode("unauthenticated"));
});

test("direct roles and IdP group mappings both grant permissions", async () => {
  const { rbac, as, ctx } = setup();
  const viewer = await rbac.admin.createRole(ctx, { name: "Viewer", permissions: ["order:view"] });
  const finance = await rbac.admin.createRole(ctx, { name: "Finance", permissions: ["invoice:view"] });
  await rbac.admin.setUserRoles(ctx, "u1", [viewer.id]);
  await rbac.admin.setGroupRoles(ctx, "Finance Team", [finance.id]);

  const p = await rbac.require("order:view", as("u1", "t1", "[Finance Team, Other]"));
  assert.deepEqual(p.permissions, ["order:view", "invoice:view"], "catalog order");
  assert.deepEqual(p.groups, ["Finance Team", "Other"]);
  await rbac.require(["order:view", "invoice:view"], as("u1", "t1", "Finance Team"));
  await assert.rejects(rbac.require(["order:view", "order:edit"], as("u1")), isCode("forbidden"));
});

test("the system role grants every permission, rbac:manage included", async () => {
  const { rbac, as } = setup();
  await rbac.admin.seedTenant("t1", "owner");
  const p = await rbac.require("rbac:manage", as("owner"));
  assert.deepEqual(p.permissions, ["order:view", "order:edit", "invoice:view", "rbac:manage"]);
});

test("permissions are scoped to the tenant", async () => {
  const { rbac, as } = setup();
  await rbac.admin.seedTenant("t1", "u1");
  assert.equal(await rbac.can("order:view", as("u1", "t1")), true);
  assert.equal(await rbac.can("order:view", as("u1", "t2")), false, "same user id in another tenant");
});

test("admin changes take effect on the next request despite the cache", async () => {
  const { rbac, as, ctx } = setup(60_000);
  const role = await rbac.admin.createRole(ctx, { name: "Viewer", permissions: ["order:view"] });
  await rbac.admin.setUserRoles(ctx, "u1", [role.id]);
  assert.equal(await rbac.can("order:edit", as("u1")), false); // now cached

  await rbac.admin.updateRole(ctx, role.id, { permissions: ["order:view", "order:edit"] });
  assert.equal(await rbac.can("order:edit", as("u1")), true);

  await rbac.admin.setUserRoles(ctx, "u1", []);
  assert.equal(await rbac.can("order:view", as("u1")), false);
});

test("a permission removed from the app's code grants nothing", async () => {
  const storage = memoryStorage();
  const role = await storage.createRole("t1", { name: "Old", description: "", permissions: ["order:delete", "order:view"] });
  await storage.setUserRoles("t1", "u1", [role.id]);
  const rbac = createRbac({
    permissions: { order: ["view"] },
    storage,
    getUser: () => ({ userId: "u1", tenantId: "t1" }),
  });
  assert.deepEqual((await rbac.identify())?.permissions, ["order:view"]);
});

test("getUser may ignore the request (server actions)", async () => {
  const rbac = createRbac({
    permissions: { order: ["view"] },
    storage: memoryStorage(),
    getUser: async () => ({ userId: "u1", tenantId: "t1" }),
  });
  await rbac.admin.seedTenant("t1", "u1");
  const p = await rbac.require("order:view");
  assert.equal(p.userId, "u1");
  assert.equal(rbac.has(p, "order:view"), true);
});

test("admin changes are reported through onChange", async () => {
  const { rbac, ctx, events } = setup();
  const role = await rbac.admin.createRole(ctx, { name: "Viewer", permissions: ["order:view"] });
  await rbac.admin.setUserRoles(ctx, "u1", [role.id]);
  assert.deepEqual(
    events.map((e) => [e.action, e.target, e.actorId, e.tenantId]),
    [
      ["role.create", role.id, "admin", "t1"],
      ["user.roles.set", "u1", "admin", "t1"],
    ],
  );
});
