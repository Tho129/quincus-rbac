import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCatalog } from "../../src/catalog";
import { fmt } from "../../src/react/labels";
import {
  dirtyRoleIds,
  displayName,
  filterUsers,
  hasPermissions,
  rolesViaGroups,
  orderByCatalog,
  sameSet,
  toggleAll,
  togglePermission,
} from "../../src/react/logic";

const catalog = buildCatalog({ order: ["view", "edit", "delete"], report: ["export"] }).groups;

test("turning an action on also turns on its resource's view", () => {
  assert.deepEqual(togglePermission([], "order:edit", true, catalog), ["order:view", "order:edit"]);
});

test("turning view off turns off the rest of the resource only", () => {
  const current = ["order:view", "order:edit", "order:delete", "report:export"];
  assert.deepEqual(togglePermission(current, "order:view", false, catalog), ["report:export"]);
});

test("turning a non-view action off leaves view on", () => {
  assert.deepEqual(togglePermission(["order:view", "order:edit"], "order:edit", false, catalog), ["order:view"]);
});

test("a resource without a view action toggles on its own", () => {
  assert.deepEqual(togglePermission([], "report:export", true, catalog), ["report:export"]);
});

test("toggleAll: anything on → all off; nothing on → everything, rbac:manage included", () => {
  assert.deepEqual(toggleAll(["order:view"], catalog), []);
  assert.deepEqual(toggleAll([], catalog), ["order:view", "order:edit", "order:delete", "report:export", "rbac:manage"]);
});

test("orderByCatalog keeps catalog order and drops unknown keys", () => {
  assert.deepEqual(orderByCatalog(["report:export", "gone:x", "order:view"], catalog), ["order:view", "report:export"]);
});

test("dirtyRoleIds compares as sets", () => {
  assert.equal(sameSet(["a", "b"], ["b", "a"]), true);
  assert.deepEqual(
    dirtyRoleIds({ r1: ["b", "a"], r2: ["a"], r3: [] }, { r1: ["a", "b"], r2: ["a", "b"], r3: [] }),
    ["r2"],
  );
});

test("filterUsers matches name, email or id, case-insensitively", () => {
  const users = [
    { id: "u1", name: "Alice Nguyen", email: "alice@acme.test", roleIds: [] },
    { id: "sub-42", roleIds: [] },
  ];
  assert.deepEqual(filterUsers(users, "ALICE").map((u) => u.id), ["u1"]);
  assert.deepEqual(filterUsers(users, "acme.test").map((u) => u.id), ["u1"]);
  assert.deepEqual(filterUsers(users, "sub-4").map((u) => u.id), ["sub-42"]);
  assert.equal(filterUsers(users, "  ").length, 2);
});

test("displayName falls back from name to email to id", () => {
  assert.equal(displayName({ id: "u1", name: "Ann", email: "a@x" }), "Ann");
  assert.equal(displayName({ id: "u1", email: "a@x" }), "a@x");
  assert.equal(displayName({ id: "u1" }), "u1");
});

test("fmt fills placeholders and leaves unknown ones", () => {
  assert.equal(fmt("Delete “{name}”? {count}/{total}", { name: "Ops", count: 2, total: 5 }), "Delete “Ops”? 2/5");
  assert.equal(fmt("{missing}", {}), "{missing}");
});

test("hasPermissions: all / any, single or list", () => {
  const held = ["order:view", "order:edit"];
  assert.equal(hasPermissions(held, "order:view", "all"), true);
  assert.equal(hasPermissions(held, "order:delete", "all"), false);
  assert.equal(hasPermissions(held, ["order:view", "order:delete"], "all"), false);
  assert.equal(hasPermissions(held, ["order:view", "order:delete"], "any"), true);
  assert.equal(hasPermissions([], ["order:view"], "any"), false);
  assert.equal(hasPermissions([], [], "all"), true, "nothing required");
  assert.equal(hasPermissions(held, [], "any"), false);
});

test("rolesViaGroups lists roles from the user's groups that are not direct", () => {
  const mappings = [
    { group: "Finance", roleIds: ["r-fin", "r-view"] },
    { group: "Staff", roleIds: ["r-view"] },
    { group: "Other", roleIds: ["r-x"] },
  ];
  assert.deepEqual(rolesViaGroups(["Finance", "Staff"], mappings, []), [
    { roleId: "r-fin", groups: ["Finance"] },
    { roleId: "r-view", groups: ["Finance", "Staff"] },
  ]);
  assert.deepEqual(rolesViaGroups(["Finance"], mappings, ["r-fin"]), [{ roleId: "r-view", groups: ["Finance"] }], "direct roles are not repeated");
  assert.deepEqual(rolesViaGroups(undefined, mappings, []), []);
  assert.deepEqual(rolesViaGroups(["Nobody"], mappings, []), []);
});
