import type { CatalogGroup } from "../catalog";
import type { Role } from "../types";
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

const PALETTE = ["#2563eb", "#16a34a", "#9333ea", "#ea580c", "#db2777", "#0891b2", "#ca8a04", "#64748b"];

/** A colour per role that stays the same when other roles come and go; the system role is always amber. */
export function roleColor(role: Pick<Role, "id" | "isSystem">): string {
  if (role.isSystem) return "#d97706";
  let hash = 0;
  for (const ch of role.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
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
