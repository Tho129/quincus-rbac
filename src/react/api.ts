import type { CatalogGroup } from "../catalog";
import type { GroupMapping, Role, TenantUser } from "../types";

export interface Me {
  userId: string;
  tenantId: string;
  groups: string[];
  permissions: string[];
}

export interface UserWithRoles extends TenantUser {
  roleIds: string[];
}

export interface RoleDraft {
  name: string;
  description?: string;
  permissions: string[];
}

/** An error answered by the admin API (`{ error: { code, message } }`). */
export class RbacApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RbacApiError";
  }
}

export interface RbacApiOptions {
  /** Where the admin API is mounted. Default `/api/rbac`. */
  apiBase?: string;
  /** Extra headers per request, e.g. `{ authorization: "Bearer …" }` when the app's auth is a header. */
  getHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Custom fetch. Default: the global `fetch`, sending same-origin cookies. */
  fetch?: typeof fetch;
}

export type RbacApi = ReturnType<typeof createRbacApi>;

/** A typed client for the package's admin API. */
export function createRbacApi(options: RbacApiOptions = {}) {
  const base = (options.apiBase ?? "/api/rbac").replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", ...(await options.getHeaders?.()) };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await doFetch(`${base}/${path}`, {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { data?: T; error?: { code: string; message: string } } | null;
    if (!res.ok) {
      throw new RbacApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? `Request failed (${res.status})`);
    }
    return json?.data as T;
  }

  const seg = encodeURIComponent;

  return {
    me: () => request<Me>("GET", "me"),
    permissions: () => request<CatalogGroup[]>("GET", "permissions"),
    roles: () => request<Role[]>("GET", "roles"),
    createRole: (draft: RoleDraft) => request<Role>("POST", "roles", draft),
    updateRole: (id: string, patch: Partial<RoleDraft>) => request<Role>("PATCH", `roles/${seg(id)}`, patch),
    deleteRole: (id: string) => request<{ deleted: true }>("DELETE", `roles/${seg(id)}`),
    users: () => request<UserWithRoles[]>("GET", "users"),
    setUserRoles: (userId: string, roleIds: string[]) =>
      request<unknown>("PUT", `users/${seg(userId)}/roles`, { roleIds }),
    groups: () => request<GroupMapping[]>("GET", "groups"),
    setGroupRoles: (group: string, roleIds: string[]) =>
      request<unknown>("PUT", `groups/${seg(group)}/roles`, { roleIds }),
    deleteGroup: (group: string) => request<{ deleted: true }>("DELETE", `groups/${seg(group)}`),
  };
}
