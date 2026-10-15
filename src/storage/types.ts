import type { GroupMapping, Role, UserAssignment } from "../types";

export interface CreateRoleInput {
  name: string;
  description: string;
  permissions: string[];
  isSystem?: boolean;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

/**
 * Where roles and assignments live. Every method is scoped by `tenantId`; an
 * implementation must never read or write another tenant's rows. Writes are
 * atomic per call. A duplicate role name (case-insensitive, per tenant)
 * throws `RbacError("conflict")`.
 */
export interface RbacStorage {
  /** Permissions granted by the user's direct roles plus their groups' roles, unfiltered. */
  getGrants(
    tenantId: string,
    userId: string,
    groups: readonly string[],
  ): Promise<{ permissions: string[]; hasSystemRole: boolean }>;

  listRoles(tenantId: string): Promise<Role[]>;
  getRole(tenantId: string, roleId: string): Promise<Role | null>;
  createRole(tenantId: string, input: CreateRoleInput): Promise<Role>;
  /** Returns null when the role does not exist in the tenant. */
  updateRole(tenantId: string, roleId: string, input: UpdateRoleInput): Promise<Role | null>;
  /** Removes the role and every assignment/mapping to it. False when it did not exist. */
  deleteRole(tenantId: string, roleId: string): Promise<boolean>;

  listUserAssignments(tenantId: string): Promise<UserAssignment[]>;
  /** Replaces the user's direct roles with exactly `roleIds`. */
  setUserRoles(tenantId: string, userId: string, roleIds: readonly string[]): Promise<void>;

  listGroupMappings(tenantId: string): Promise<GroupMapping[]>;
  /** Replaces the group's roles with exactly `roleIds` (empty removes the mapping). */
  setGroupRoles(tenantId: string, group: string, roleIds: readonly string[]): Promise<void>;
}
