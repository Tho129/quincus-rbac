import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdmin, seedTenantAdmin } from "../../src/admin";
import { buildCatalog } from "../../src/catalog";
import { RbacError } from "../../src/errors";
import { memoryStorage } from "../../src/storage/memory";

function setup(listUsers?: (tenantId: string) => Promise<{ id: string; name?: string }[]>) {
  const storage = memoryStorage();
  const invalidated: string[] = [];
  const admin = createAdmin({
    storage,
    catalog: buildCatalog({ order: ["view", "edit"] }),
    listUsers,
    invalidate: (t) => invalidated.push(t),
  });
  return { admin, storage, invalidated, ctx: { tenantId: "t1", actorId: "a" } };
}

const isCode = (code: string) => (err: unknown) => err instanceof RbacError && err.code === code;

test("createRole validates name, description and permissions", async () => {
  const { admin, ctx } = setup();
  await assert.rejects(admin.createRole(ctx, { name: "  ", permissions: [] }), isCode("invalid_request"));
  await assert.rejects(admin.createRole(ctx, { name: "x".repeat(101), permissions: [] }), isCode("invalid_request"));
  await assert.rejects(admin.createRole(ctx, { name: "A", permissions: ["order:delete"] }), isCode("invalid_request"));
  await assert.rejects(
    admin.createRole(ctx, { name: "A", permissions: "order:view" as unknown as string[] }),
    isCode("invalid_request"),
  );
  const role = await admin.createRole(ctx, { name: "  Viewer ", permissions: ["order:view", "order:view"] });
  assert.equal(role.name, "Viewer");
  assert.deepEqual(role.permissions, ["order:view"]);
});

test("every write invalidates the tenant's cache", async () => {
  const { admin, ctx, invalidated } = setup();
  const role = await admin.createRole(ctx, { name: "A", permissions: [] });
  await admin.updateRole(ctx, role.id, { name: "B" });
  await admin.setUserRoles(ctx, "u1", [role.id]);
  await admin.setGroupRoles(ctx, "G", [role.id]);
  await admin.setUserRoles(ctx, "u1", []);
  await admin.deleteRole(ctx, role.id);
  assert.deepEqual(invalidated, ["t1", "t1", "t1", "t1", "t1", "t1"]);
});

test("the system role cannot be edited or deleted", async () => {
  const { admin, ctx } = setup();
  const system = await admin.seedTenant("t1", "owner");
  await assert.rejects(admin.updateRole(ctx, system.id, { name: "Mine" }), isCode("conflict"));
  await assert.rejects(admin.deleteRole(ctx, system.id), isCode("conflict"));
});

test("unknown roles are not_found; unknown role ids in assignments are invalid", async () => {
  const { admin, ctx } = setup();
  await assert.rejects(admin.getRole(ctx, "nope"), isCode("not_found"));
  await assert.rejects(admin.updateRole(ctx, "nope", { name: "x" }), isCode("not_found"));
  await assert.rejects(admin.setUserRoles(ctx, "u1", ["nope"]), isCode("invalid_request"));
  await assert.rejects(admin.setGroupRoles(ctx, "G", "nope"), isCode("invalid_request"));
});

test("a role id of another tenant cannot be assigned", async () => {
  const { admin, ctx } = setup();
  const other = await admin.createRole({ tenantId: "t2", actorId: "a" }, { name: "A", permissions: [] });
  await assert.rejects(admin.setUserRoles(ctx, "u1", [other.id]), isCode("invalid_request"));
});

test("refuses to remove the last administrator", async () => {
  const { admin, ctx } = setup();
  const system = await admin.seedTenant("t1", "owner");
  await assert.rejects(admin.setUserRoles(ctx, "owner", []), isCode("conflict"));

  // A second admin through a custom role with rbac:manage makes it safe.
  const managers = await admin.createRole(ctx, { name: "Managers", permissions: ["rbac:manage"] });
  await admin.setUserRoles(ctx, "u2", [managers.id]);
  await admin.setUserRoles(ctx, "owner", []);

  // Now u2 is the last one: stripping rbac:manage or deleting the role is refused.
  await assert.rejects(admin.updateRole(ctx, managers.id, { permissions: [] }), isCode("conflict"));
  await assert.rejects(admin.deleteRole(ctx, managers.id), isCode("conflict"));

  // A group mapping to the system role also counts as an administrator.
  await admin.setGroupRoles(ctx, "Admins", [system.id]);
  await admin.deleteRole(ctx, managers.id);
  await assert.rejects(admin.setGroupRoles(ctx, "Admins", []), isCode("conflict"));
});

test("listUsers merges the app's users with assignment-only users", async () => {
  const { admin, ctx } = setup(async () => [{ id: "u1", name: "Ann" }, { id: "u2", name: "Bob" }]);
  const role = await admin.createRole(ctx, { name: "A", permissions: [] });
  await admin.setUserRoles(ctx, "u1", [role.id]);
  await admin.setUserRoles(ctx, "ghost", [role.id]);
  assert.deepEqual(await admin.listUsers(ctx), [
    { id: "u1", name: "Ann", roleIds: [role.id] },
    { id: "u2", name: "Bob", roleIds: [] },
    { id: "ghost", roleIds: [role.id] },
  ]);
});

test("seedTenantAdmin is idempotent and keeps the user's other roles", async () => {
  const { admin, storage, ctx } = setup();
  const viewer = await admin.createRole(ctx, { name: "Viewer", permissions: ["order:view"] });
  await storage.setUserRoles("t1", "u1", [viewer.id]);
  const first = await seedTenantAdmin(storage, "t1", "u1");
  const second = await seedTenantAdmin(storage, "t1", "u1");
  assert.equal(first.id, second.id);
  assert.equal(first.isSystem, true);
  const roles = (await storage.listUserAssignments("t1")).find((a) => a.userId === "u1")?.roleIds;
  assert.deepEqual(roles?.sort(), [first.id, viewer.id].sort());
});

test("seedTenantAdmin avoids a name clash with an existing custom Admin role", async () => {
  const { admin, storage, ctx } = setup();
  await admin.createRole(ctx, { name: "admin", permissions: [] });
  const system = await seedTenantAdmin(storage, "t1", "u1");
  assert.equal(system.name, "System Admin");
});
