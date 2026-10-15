import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { RbacError } from "../../src/errors";
import type { RbacStorage } from "../../src/storage/types";

export interface StorageFixture {
  storage: RbacStorage;
  teardown: () => Promise<void>;
}

/**
 * Behaviour every `RbacStorage` must share. Each case gets a fresh fixture and
 * fresh tenant ids. A case that expects a database error ends on it (a failed
 * statement aborts a Postgres transaction).
 */
export function storageContract(name: string, setup: () => Promise<StorageFixture>) {
  const tenant = () => `t-${randomUUID()}`;

  const run = (title: string, fn: (s: RbacStorage) => Promise<void>) =>
    test(`${name}: ${title}`, async () => {
      const { storage, teardown } = await setup();
      try {
        await fn(storage);
      } finally {
        await teardown();
      }
    });

  run("creates, reads and lists roles", async (s) => {
    const t = tenant();
    const role = await s.createRole(t, { name: "Dispatcher", description: "d", permissions: ["order:view", "order:edit"] });
    assert.equal(role.name, "Dispatcher");
    assert.equal(role.isSystem, false);
    assert.deepEqual(role.permissions, ["order:edit", "order:view"]);
    assert.deepEqual(await s.getRole(t, role.id), role);

    const system = await s.createRole(t, { name: "Admin", description: "", permissions: [], isSystem: true });
    const roles = await s.listRoles(t);
    assert.deepEqual(roles.map((r) => r.id), [system.id, role.id], "system roles first");
  });

  run("returns null / false for unknown or malformed role ids", async (s) => {
    const t = tenant();
    assert.equal(await s.getRole(t, randomUUID()), null);
    assert.equal(await s.getRole(t, "not-a-uuid"), null);
    assert.equal(await s.updateRole(t, randomUUID(), { name: "x" }), null);
    assert.equal(await s.deleteRole(t, "not-a-uuid"), false);
  });

  run("updates name, description and replaces permissions", async (s) => {
    const t = tenant();
    const role = await s.createRole(t, { name: "A", description: "", permissions: ["order:view", "order:edit"] });
    const updated = await s.updateRole(t, role.id, { name: "B", permissions: ["order:view", "invoice:view"] });
    assert.equal(updated?.name, "B");
    assert.deepEqual(updated?.permissions, ["invoice:view", "order:view"]);

    const renamedOnly = await s.updateRole(t, role.id, { description: "new" });
    assert.equal(renamedOnly?.description, "new");
    assert.deepEqual(renamedOnly?.permissions, ["invoice:view", "order:view"], "permissions untouched when omitted");
  });

  run("replaces user roles and lists assignments", async (s) => {
    const t = tenant();
    const a = await s.createRole(t, { name: "A", description: "", permissions: [] });
    const b = await s.createRole(t, { name: "B", description: "", permissions: [] });
    await s.setUserRoles(t, "u1", [a.id, b.id]);
    await s.setUserRoles(t, "u1", [b.id]);
    await s.setUserRoles(t, "u2", [a.id]);
    assert.deepEqual(await s.listUserAssignments(t), [
      { userId: "u1", roleIds: [b.id] },
      { userId: "u2", roleIds: [a.id] },
    ]);
    await s.setUserRoles(t, "u2", []);
    assert.deepEqual((await s.listUserAssignments(t)).map((x) => x.userId), ["u1"]);
  });

  run("maps groups and an empty list removes the mapping", async (s) => {
    const t = tenant();
    const a = await s.createRole(t, { name: "A", description: "", permissions: [] });
    await s.setGroupRoles(t, "Ops", [a.id]);
    assert.deepEqual(await s.listGroupMappings(t), [{ group: "Ops", roleIds: [a.id] }]);
    await s.setGroupRoles(t, "Ops", []);
    assert.deepEqual(await s.listGroupMappings(t), []);
  });

  run("grants the union of direct and group roles", async (s) => {
    const t = tenant();
    const direct = await s.createRole(t, { name: "Direct", description: "", permissions: ["order:view"] });
    const viaGroup = await s.createRole(t, { name: "Group", description: "", permissions: ["invoice:view", "order:view"] });
    const system = await s.createRole(t, { name: "Admin", description: "", permissions: [], isSystem: true });
    await s.setUserRoles(t, "u1", [direct.id]);
    await s.setGroupRoles(t, "Finance", [viaGroup.id]);
    await s.setGroupRoles(t, "Admins", [system.id]);

    const none = await s.getGrants(t, "nobody", []);
    assert.deepEqual(none, { permissions: [], hasSystemRole: false });

    const onlyDirect = await s.getGrants(t, "u1", []);
    assert.deepEqual(onlyDirect.permissions.sort(), ["order:view"]);

    const both = await s.getGrants(t, "u1", ["Finance"]);
    assert.deepEqual(both.permissions.sort(), ["invoice:view", "order:view"]);
    assert.equal(both.hasSystemRole, false);

    assert.equal((await s.getGrants(t, "u9", ["Admins"])).hasSystemRole, true);
  });

  run("deleting a role removes its assignments and mappings", async (s) => {
    const t = tenant();
    const a = await s.createRole(t, { name: "A", description: "", permissions: ["order:view"] });
    const b = await s.createRole(t, { name: "B", description: "", permissions: [] });
    await s.setUserRoles(t, "u1", [a.id, b.id]);
    await s.setGroupRoles(t, "Ops", [a.id]);
    assert.equal(await s.deleteRole(t, a.id), true);
    assert.deepEqual(await s.listUserAssignments(t), [{ userId: "u1", roleIds: [b.id] }]);
    assert.deepEqual(await s.listGroupMappings(t), []);
    assert.deepEqual((await s.getGrants(t, "u1", ["Ops"])).permissions, []);
  });

  run("keeps tenants apart", async (s) => {
    const t1 = tenant();
    const t2 = tenant();
    const role = await s.createRole(t1, { name: "A", description: "", permissions: ["order:view"] });
    await s.setUserRoles(t1, "u1", [role.id]);

    assert.deepEqual(await s.listRoles(t2), []);
    assert.equal(await s.getRole(t2, role.id), null);
    assert.equal(await s.updateRole(t2, role.id, { name: "hijack" }), null);
    assert.equal(await s.deleteRole(t2, role.id), false);
    assert.deepEqual((await s.getGrants(t2, "u1", [])).permissions, [], "same user id, other tenant");
    // The same role name is free in another tenant.
    await s.createRole(t2, { name: "A", description: "", permissions: [] });
    // Assigning another tenant's role is refused (last: fails the statement).
    await assert.rejects(
      s.setUserRoles(t2, "u1", [role.id]),
      (err: unknown) => err instanceof RbacError && err.code === "invalid_request",
    );
  });

  run("rejects a duplicate role name, case-insensitively", async (s) => {
    const t = tenant();
    await s.createRole(t, { name: "Dispatcher", description: "", permissions: [] });
    await assert.rejects(
      s.createRole(t, { name: "dispatcher", description: "", permissions: [] }),
      (err: unknown) => err instanceof RbacError && err.code === "conflict",
    );
  });
}
