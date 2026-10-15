import assert from "node:assert/strict";
import { test } from "node:test";
import { PermissionCache } from "../../src/cache";
import { RBAC_MANAGE, buildCatalog } from "../../src/catalog";
import { parseGroups } from "../../src/groups";

test("parseGroups accepts Cognito's single and bracketed forms", () => {
  assert.deepEqual(parseGroups("Admins"), ["Admins"]);
  assert.deepEqual(parseGroups("[Admins, Finance Team]"), ["Admins", "Finance Team"]);
  assert.deepEqual(parseGroups("[Admins]"), ["Admins"]);
  assert.deepEqual(parseGroups("[]"), []);
});

test("parseGroups accepts arrays and JSON, trims and de-duplicates", () => {
  assert.deepEqual(parseGroups(["A", " B ", "A", ""]), ["A", "B"]);
  assert.deepEqual(parseGroups('["A","B"]'), ["A", "B"]);
  assert.deepEqual(parseGroups("['A', 'B']"), ["A", "B"]);
});

test("parseGroups yields nothing for missing or odd input", () => {
  assert.deepEqual(parseGroups(undefined), []);
  assert.deepEqual(parseGroups(null), []);
  assert.deepEqual(parseGroups("   "), []);
  assert.deepEqual(parseGroups(42), []);
  assert.deepEqual(parseGroups([1, {}, "A"]), ["A"]);
});

test("buildCatalog turns the map into keys and appends rbac:manage", () => {
  const catalog = buildCatalog({ order: ["view", "edit"], invoice: ["view"] });
  assert.deepEqual(catalog.keys, ["order:view", "order:edit", "invoice:view", RBAC_MANAGE]);
  assert.equal(catalog.has("order:edit"), true);
  assert.equal(catalog.has("order:delete"), false);
  assert.deepEqual(
    catalog.groups.map((g) => g.resource),
    ["order", "invoice", "rbac"],
  );
});

test("buildCatalog derives display labels for the list form", () => {
  const catalog = buildCatalog({ purchase_order: ["view", "bulk_import"] });
  const group = catalog.groups[0]!;
  assert.equal(group.label, "Purchase order");
  assert.deepEqual(
    group.permissions.map((p) => p.label),
    ["View purchase order", "Bulk import purchase order"],
  );
});

test("buildCatalog keeps labels and descriptions from the object form", () => {
  const catalog = buildCatalog({
    order: {
      label: "Orders",
      actions: { view: "View orders", edit: { label: "Edit orders", description: "Change quantities" }, delete: {} },
    },
  });
  assert.deepEqual(catalog.keys, ["order:view", "order:edit", "order:delete", RBAC_MANAGE]);
  assert.deepEqual(catalog.groups[0], {
    resource: "order",
    label: "Orders",
    permissions: [
      { key: "order:view", action: "view", label: "View orders" },
      { key: "order:edit", action: "edit", label: "Edit orders", description: "Change quantities" },
      { key: "order:delete", action: "delete", label: "Delete orders" },
    ],
  });
  assert.equal(catalog.groups.at(-1)?.permissions[0]?.key, RBAC_MANAGE);
});

test("buildCatalog rejects reserved, malformed and duplicate names", () => {
  assert.throws(() => buildCatalog({ rbac: ["view"] }), /reserved/);
  assert.throws(() => buildCatalog({ "or:der": ["view"] }), /invalid resource/);
  assert.throws(() => buildCatalog({ order: ["vi ew"] }), /invalid action/);
  assert.throws(() => buildCatalog({ order: ["view", "view"] }), /declared twice/);
  assert.throws(() => buildCatalog({ order: { actions: { "bad name": "x" } } }), /invalid action/);
});

test("PermissionCache expires entries after the TTL", () => {
  let now = 1000;
  const cache = new PermissionCache(500, 100, () => now);
  cache.set("t1", "u1", ["B", "A"], ["order:view"]);
  assert.deepEqual(cache.get("t1", "u1", ["A", "B"]), ["order:view"], "group order does not matter");
  now += 500;
  assert.equal(cache.get("t1", "u1", ["A", "B"]), undefined);
});

test("PermissionCache invalidates one tenant only", () => {
  const cache = new PermissionCache(60_000);
  cache.set("t1", "u1", [], ["a"]);
  cache.set("t10", "u1", [], ["b"]);
  cache.invalidate("t1");
  assert.equal(cache.get("t1", "u1", []), undefined);
  assert.deepEqual(cache.get("t10", "u1", []), ["b"], "a tenant id that shares a prefix is untouched");
});

test("PermissionCache with TTL 0 stores nothing", () => {
  const cache = new PermissionCache(0);
  cache.set("t1", "u1", [], ["a"]);
  assert.equal(cache.get("t1", "u1", []), undefined);
});

test("PermissionCache evicts the oldest entry at capacity", () => {
  const cache = new PermissionCache(60_000, 2);
  cache.set("t", "u1", [], ["a"]);
  cache.set("t", "u2", [], ["b"]);
  cache.set("t", "u3", [], ["c"]);
  assert.equal(cache.get("t", "u1", []), undefined);
  assert.deepEqual(cache.get("t", "u3", []), ["c"]);
});
