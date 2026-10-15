import { RBAC_MANAGE, type Catalog } from "./catalog";
import { RbacError } from "./errors";
import type { RbacStorage } from "./storage/types";
import type {
  GroupMapping,
  RbacChangeEvent,
  Role,
  TenantUser,
  UserAssignment,
} from "./types";

/** Who is acting, and in which tenant. Every admin operation is confined to `tenantId`. */
export interface AdminContext {
  tenantId: string;
  actorId: string;
}

export interface AdminDeps {
  storage: RbacStorage;
  catalog: Catalog;
  listUsers?: (tenantId: string) => Promise<TenantUser[]>;
  onChange?: (event: RbacChangeEvent) => void | Promise<void>;
  invalidate: (tenantId: string) => void;
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export interface RolePatch {
  name?: string;
  description?: string;
  permissions?: string[];
}

export interface TenantUserWithRoles extends TenantUser {
  roleIds: string[];
}

const SYSTEM_ROLE_NAME = "Admin";
const MAX_NAME = 100;
const MAX_DESCRIPTION = 500;
const MAX_ID = 255;

type Change =
  | { kind: "user"; userId: string; roleIds: string[] }
  | { kind: "group"; group: string; roleIds: string[] }
  | { kind: "permissions"; roleId: string; permissions: string[] }
  | { kind: "delete"; roleId: string };

/**
 * The role/permission management operations behind the admin API and CLI.
 * Usable directly from server actions: `rbac.admin.createRole(ctx, …)`.
 * Authorisation (`rbac:manage`) is the caller's job — the HTTP handler does it.
 */
export function createAdmin(deps: AdminDeps) {
  const { storage, catalog } = deps;

  const changed = async (event: RbacChangeEvent) => {
    deps.invalidate(event.tenantId);
    await deps.onChange?.(event);
  };

  const validPermissions = (input: unknown): string[] => {
    if (!Array.isArray(input) || input.some((p) => typeof p !== "string")) {
      throw new RbacError("invalid_request", "permissions must be an array of strings");
    }
    const unknown = input.filter((p) => !catalog.has(p));
    if (unknown.length) throw new RbacError("invalid_request", `Unknown permissions: ${unknown.join(", ")}`);
    return [...new Set(input as string[])];
  };

  const validRoleIds = async (tenantId: string, input: unknown): Promise<string[]> => {
    if (!Array.isArray(input) || input.some((id) => typeof id !== "string")) {
      throw new RbacError("invalid_request", "roleIds must be an array of strings");
    }
    const ids = [...new Set(input as string[])];
    const known = new Set((await storage.listRoles(tenantId)).map((r) => r.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) throw new RbacError("invalid_request", `Unknown roles: ${unknown.join(", ")}`);
    return ids;
  };

  const editableRole = async (tenantId: string, roleId: string): Promise<Role> => {
    const role = await storage.getRole(tenantId, roleId);
    if (!role) throw new RbacError("not_found", "Role not found");
    if (role.isSystem) throw new RbacError("conflict", "The system role cannot be changed or deleted");
    return role;
  };

  /**
   * Refuses a change that would leave a tenant which has an administrator
   * (a user or group on a role granting `rbac:manage`) with none.
   */
  const assertKeepsAnAdmin = async (tenantId: string, change: Change) => {
    const [roles, users, groups] = await Promise.all([
      storage.listRoles(tenantId),
      storage.listUserAssignments(tenantId),
      storage.listGroupMappings(tenantId),
    ]);
    const before = countAdmins(roles, users, groups);
    if (before === 0) return;
    const after = countAdmins(...applyChange(roles, users, groups, change));
    if (after === 0) {
      throw new RbacError(
        "conflict",
        `This change would leave nobody with ${RBAC_MANAGE}; assign another administrator first`,
      );
    }
  };

  return {
    listPermissions() {
      return catalog.groups;
    },

    listRoles(ctx: AdminContext) {
      return storage.listRoles(ctx.tenantId);
    },

    async getRole(ctx: AdminContext, roleId: string) {
      const role = await storage.getRole(ctx.tenantId, roleId);
      if (!role) throw new RbacError("not_found", "Role not found");
      return role;
    },

    async createRole(ctx: AdminContext, input: RoleInput): Promise<Role> {
      const role = await storage.createRole(ctx.tenantId, {
        name: text(input.name, "name", MAX_NAME, true),
        description: text(input.description ?? "", "description", MAX_DESCRIPTION, false),
        permissions: validPermissions(input.permissions),
      });
      await changed({ ...event(ctx, "role.create", role.id), details: { name: role.name, permissions: role.permissions } });
      return role;
    },

    async updateRole(ctx: AdminContext, roleId: string, patch: RolePatch): Promise<Role> {
      await editableRole(ctx.tenantId, roleId);
      const input = {
        name: patch.name === undefined ? undefined : text(patch.name, "name", MAX_NAME, true),
        description:
          patch.description === undefined ? undefined : text(patch.description, "description", MAX_DESCRIPTION, false),
        permissions: patch.permissions === undefined ? undefined : validPermissions(patch.permissions),
      };
      if (input.permissions) {
        await assertKeepsAnAdmin(ctx.tenantId, { kind: "permissions", roleId, permissions: input.permissions });
      }
      const role = await storage.updateRole(ctx.tenantId, roleId, input);
      if (!role) throw new RbacError("not_found", "Role not found");
      await changed({ ...event(ctx, "role.update", roleId), details: { ...input } });
      return role;
    },

    async deleteRole(ctx: AdminContext, roleId: string): Promise<void> {
      const role = await editableRole(ctx.tenantId, roleId);
      await assertKeepsAnAdmin(ctx.tenantId, { kind: "delete", roleId });
      if (!(await storage.deleteRole(ctx.tenantId, roleId))) throw new RbacError("not_found", "Role not found");
      await changed({ ...event(ctx, "role.delete", roleId), details: { name: role.name } });
    },

    /** The app's users (from `listUsers`) merged with everyone who holds a direct role. */
    async listUsers(ctx: AdminContext): Promise<TenantUserWithRoles[]> {
      const [known, assignments] = await Promise.all([
        deps.listUsers ? deps.listUsers(ctx.tenantId) : Promise.resolve([] as TenantUser[]),
        storage.listUserAssignments(ctx.tenantId),
      ]);
      const roleIds = new Map(assignments.map((a) => [a.userId, a.roleIds]));
      const out: TenantUserWithRoles[] = known.map((u) => ({ ...u, roleIds: roleIds.get(u.id) ?? [] }));
      const seen = new Set(known.map((u) => u.id));
      for (const a of assignments) if (!seen.has(a.userId)) out.push({ id: a.userId, roleIds: a.roleIds });
      return out;
    },

    async setUserRoles(ctx: AdminContext, userId: string, roleIds: unknown): Promise<void> {
      const id = text(userId, "userId", MAX_ID, true);
      const ids = await validRoleIds(ctx.tenantId, roleIds);
      await assertKeepsAnAdmin(ctx.tenantId, { kind: "user", userId: id, roleIds: ids });
      await storage.setUserRoles(ctx.tenantId, id, ids);
      await changed({ ...event(ctx, "user.roles.set", id), details: { roleIds: ids } });
    },

    listGroups(ctx: AdminContext): Promise<GroupMapping[]> {
      return storage.listGroupMappings(ctx.tenantId);
    },

    async setGroupRoles(ctx: AdminContext, group: string, roleIds: unknown): Promise<void> {
      const name = text(group, "group", MAX_ID, true);
      const ids = await validRoleIds(ctx.tenantId, roleIds);
      await assertKeepsAnAdmin(ctx.tenantId, { kind: "group", group: name, roleIds: ids });
      await storage.setGroupRoles(ctx.tenantId, name, ids);
      await changed({ ...event(ctx, "group.roles.set", name), details: { roleIds: ids } });
    },

    /**
     * Makes `userId` an administrator of `tenantId`: ensures the tenant has its
     * system role (all permissions) and adds the user to it. Idempotent — call
     * it when a tenant is created, or via `quincus-rbac grant-admin`.
     */
    async seedTenant(tenantId: string, userId: string, actorId = "system"): Promise<Role> {
      const role = await seedTenantAdmin(storage, tenantId, text(userId, "userId", MAX_ID, true));
      await changed({ tenantId, actorId, action: "tenant.seed", target: userId, details: { roleId: role.id } });
      return role;
    },
  };
}

export type RbacAdmin = ReturnType<typeof createAdmin>;

/** Storage-level core of `seedTenant`, shared with the CLI (which has no catalog). */
export async function seedTenantAdmin(storage: RbacStorage, tenantId: string, userId: string): Promise<Role> {
  const roles = await storage.listRoles(tenantId);
  let role = roles.find((r) => r.isSystem);
  if (!role) {
    const taken = new Set(roles.map((r) => r.name.toLowerCase()));
    const name = taken.has(SYSTEM_ROLE_NAME.toLowerCase()) ? `System ${SYSTEM_ROLE_NAME}` : SYSTEM_ROLE_NAME;
    role = await storage.createRole(tenantId, {
      name,
      description: "Full access, including role and permission management.",
      permissions: [],
      isSystem: true,
    });
  }
  const current = (await storage.listUserAssignments(tenantId)).find((a) => a.userId === userId)?.roleIds ?? [];
  if (!current.includes(role.id)) await storage.setUserRoles(tenantId, userId, [...current, role.id]);
  return role;
}

function event(ctx: AdminContext, action: RbacChangeEvent["action"], target: string): RbacChangeEvent {
  return { tenantId: ctx.tenantId, actorId: ctx.actorId, action, target };
}

function text(value: unknown, field: string, max: number, required: boolean): string {
  if (typeof value !== "string") throw new RbacError("invalid_request", `${field} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new RbacError("invalid_request", `${field} is required`);
  if (trimmed.length > max) throw new RbacError("invalid_request", `${field} must be at most ${max} characters`);
  return trimmed;
}

function grantsManage(role: Role): boolean {
  return role.isSystem || role.permissions.includes(RBAC_MANAGE);
}

function countAdmins(roles: Role[], users: UserAssignment[], groups: GroupMapping[]): number {
  const admin = new Set(roles.filter(grantsManage).map((r) => r.id));
  return [...users, ...groups].filter((a) => a.roleIds.some((id) => admin.has(id))).length;
}

function applyChange(
  roles: Role[],
  users: UserAssignment[],
  groups: GroupMapping[],
  change: Change,
): [Role[], UserAssignment[], GroupMapping[]] {
  switch (change.kind) {
    case "user":
      return [
        roles,
        [...users.filter((u) => u.userId !== change.userId), { userId: change.userId, roleIds: change.roleIds }],
        groups,
      ];
    case "group":
      return [
        roles,
        users,
        [...groups.filter((g) => g.group !== change.group), { group: change.group, roleIds: change.roleIds }],
      ];
    case "permissions":
      return [
        roles.map((r) => (r.id === change.roleId ? { ...r, permissions: change.permissions } : r)),
        users,
        groups,
      ];
    case "delete":
      return [roles.filter((r) => r.id !== change.roleId), users, groups];
  }
}
