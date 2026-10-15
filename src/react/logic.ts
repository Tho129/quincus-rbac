import type { CatalogGroup } from "../catalog";
import type { GroupMapping, Role } from "../types";
import type { UserWithRoles } from "./api";

/**
 * Turns one permission on or off for a role, keeping the "view" rule the
 * Manifold matrix uses: any other action of a resource needs its `view`, so
 * turning one on turns `view` on, and turning `view` off turns the rest off.
 * Returns a new, catalog-ordered list.
 */
export function togglePermission(
  current: readonly string[],
  key: string,
  on: boolean,
  catalog: readonly CatalogGroup[],
): string[] {
  const next = new Set(current);
  const group = catalog.find((g) => g.permissions.some((p) => p.key === key));
  const viewKey = group?.permissions.find((p) => p.action === "view")?.key;
  const isView = key === viewKey;

  if (on) {
    next.add(key);
    if (viewKey && !isView) next.add(viewKey);
  } else {
    next.delete(key);
    if (group && isView) for (const p of group.permissions) next.delete(p.key);
  }
  return orderByCatalog(next, catalog);
}

/** The column's "All on / All off" switch, as in Manifold: anything on → all off; nothing on → all on. */
export function toggleAll(current: readonly string[], catalog: readonly CatalogGroup[]): string[] {
  return current.length > 0 ? [] : allKeys(catalog);
}

export function allKeys(catalog: readonly CatalogGroup[]): string[] {
  return catalog.flatMap((g) => g.permissions.map((p) => p.key));
}

export function orderByCatalog(keys: Iterable<string>, catalog: readonly CatalogGroup[]): string[] {
  const set = new Set(keys);
  return allKeys(catalog).filter((k) => set.has(k));
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/** Role ids whose draft permissions differ from the saved ones. */
export function dirtyRoleIds(
  draft: Readonly<Record<string, readonly string[]>>,
  saved: Readonly<Record<string, readonly string[]>>,
): string[] {
  return Object.keys(draft).filter((id) => !sameSet(draft[id] ?? [], saved[id] ?? []));
}

export function permissionsByRole(roles: readonly Role[]): Record<string, string[]> {
  return Object.fromEntries(roles.map((r) => [r.id, [...r.permissions]]));
}

/** Case-insensitive match on name, email or id. */
export function filterUsers(users: readonly UserWithRoles[], query: string): UserWithRoles[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...users];
  return users.filter((u) => [u.name, u.email, u.id].some((v) => v?.toLowerCase().includes(q)));
}

export function displayName(user: Pick<UserWithRoles, "id" | "name" | "email">): string {
  return user.name || user.email || user.id;
}

/** Whether `held` covers `wanted`: every listed permission ("all") or at least one ("any"). */
export function hasPermissions(
  held: readonly string[],
  wanted: string | readonly string[],
  mode: "all" | "any",
): boolean {
  const list: readonly string[] = typeof wanted === "string" ? [wanted] : wanted;
  if (list.length === 0) return mode === "all";
  return mode === "all" ? list.every((p) => held.includes(p)) : list.some((p) => held.includes(p));
}

export interface InheritedRole {
  roleId: string;
  /** The user's groups that grant it, in mapping order. */
  groups: string[];
}

/**
 * Roles a user gets through their IdP groups and not already directly —
 * what the Users tab shows next to the direct roles.
 */
export function rolesViaGroups(
  userGroups: readonly string[] | undefined,
  mappings: readonly GroupMapping[],
  directRoleIds: readonly string[],
): InheritedRole[] {
  if (!userGroups?.length) return [];
  const mine = new Set(userGroups);
  const direct = new Set(directRoleIds);
  const byRole = new Map<string, string[]>();
  for (const m of mappings) {
    if (!mine.has(m.group)) continue;
    for (const roleId of m.roleIds) {
      if (direct.has(roleId)) continue;
      const groups = byRole.get(roleId) ?? [];
      groups.push(m.group);
      byRole.set(roleId, groups);
    }
  }
  return [...byRole].map(([roleId, groups]) => ({ roleId, groups }));
}
