import { randomUUID } from "node:crypto";
import { RbacError } from "../errors";
import type { GroupMapping, Role, UserAssignment } from "../types";
import type { CreateRoleInput, RbacStorage, UpdateRoleInput } from "./types";

interface TenantData {
  roles: Map<string, Role>;
  users: Map<string, Set<string>>;
  groups: Map<string, Set<string>>;
}

/**
 * In-process storage with the same semantics as `pgStorage`. Meant for tests
 * and local prototypes — nothing survives a restart.
 */
export function memoryStorage(): RbacStorage {
  const tenants = new Map<string, TenantData>();

  const tenant = (tenantId: string): TenantData => {
    let data = tenants.get(tenantId);
    if (!data) {
      data = { roles: new Map(), users: new Map(), groups: new Map() };
      tenants.set(tenantId, data);
    }
    return data;
  };

  const copy = (role: Role): Role => ({ ...role, permissions: [...role.permissions] });

  const assertUniqueName = (data: TenantData, name: string, exceptId?: string) => {
    const lower = name.toLowerCase();
    for (const role of data.roles.values()) {
      if (role.id !== exceptId && role.name.toLowerCase() === lower) {
        throw new RbacError("conflict", `A role named "${name}" already exists`);
      }
    }
  };

  const assertRolesExist = (data: TenantData, roleIds: readonly string[]) => {
    for (const id of roleIds) {
      if (!data.roles.has(id)) throw new RbacError("invalid_request", `Unknown role ${id}`);
    }
  };

  const setAssignment = (map: Map<string, Set<string>>, key: string, roleIds: readonly string[]) => {
    if (roleIds.length === 0) map.delete(key);
    else map.set(key, new Set(roleIds));
  };

  const listAssignments = (map: Map<string, Set<string>>) =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, ids]) => ({ key, roleIds: [...ids].sort() }));

  return {
    async getGrants(tenantId, userId, groups) {
      const data = tenant(tenantId);
      const roleIds = new Set(data.users.get(userId) ?? []);
      for (const group of groups) for (const id of data.groups.get(group) ?? []) roleIds.add(id);

      const permissions = new Set<string>();
      let hasSystemRole = false;
      for (const id of roleIds) {
        const role = data.roles.get(id);
        if (!role) continue;
        if (role.isSystem) hasSystemRole = true;
        for (const p of role.permissions) permissions.add(p);
      }
      return { permissions: [...permissions], hasSystemRole };
    },

    async listRoles(tenantId) {
      return [...tenant(tenantId).roles.values()]
        .sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name))
        .map(copy);
    },

    async getRole(tenantId, roleId) {
      const role = tenant(tenantId).roles.get(roleId);
      return role ? copy(role) : null;
    },

    async createRole(tenantId, input: CreateRoleInput) {
      const data = tenant(tenantId);
      assertUniqueName(data, input.name);
      const now = new Date().toISOString();
      const role: Role = {
        id: randomUUID(),
        name: input.name,
        description: input.description,
        isSystem: input.isSystem ?? false,
        permissions: [...new Set(input.permissions)].sort(),
        createdAt: now,
        updatedAt: now,
      };
      data.roles.set(role.id, role);
      return copy(role);
    },

    async updateRole(tenantId, roleId, input: UpdateRoleInput) {
      const data = tenant(tenantId);
      const role = data.roles.get(roleId);
      if (!role) return null;
      if (input.name !== undefined) assertUniqueName(data, input.name, roleId);
      const next: Role = {
        ...role,
        name: input.name ?? role.name,
        description: input.description ?? role.description,
        permissions: input.permissions ? [...new Set(input.permissions)].sort() : role.permissions,
        updatedAt: new Date().toISOString(),
      };
      data.roles.set(roleId, next);
      return copy(next);
    },

    async deleteRole(tenantId, roleId) {
      const data = tenant(tenantId);
      if (!data.roles.delete(roleId)) return false;
      for (const map of [data.users, data.groups]) {
        for (const [key, ids] of map) {
          ids.delete(roleId);
          if (ids.size === 0) map.delete(key);
        }
      }
      return true;
    },

    async listUserAssignments(tenantId): Promise<UserAssignment[]> {
      return listAssignments(tenant(tenantId).users).map(({ key, roleIds }) => ({ userId: key, roleIds }));
    },

    async setUserRoles(tenantId, userId, roleIds) {
      const data = tenant(tenantId);
      assertRolesExist(data, roleIds);
      setAssignment(data.users, userId, roleIds);
    },

    async listGroupMappings(tenantId): Promise<GroupMapping[]> {
      return listAssignments(tenant(tenantId).groups).map(({ key, roleIds }) => ({ group: key, roleIds }));
    },

    async setGroupRoles(tenantId, group, roleIds) {
      const data = tenant(tenantId);
      assertRolesExist(data, roleIds);
      setAssignment(data.groups, group, roleIds);
    },
  };
}
