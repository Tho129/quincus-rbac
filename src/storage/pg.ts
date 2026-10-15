import { Pool } from "pg";
import { RbacError } from "../errors";
import type { GroupMapping, Role, UserAssignment } from "../types";
import type { CreateRoleInput, RbacStorage, UpdateRoleInput } from "./types";

/**
 * Anything with pg's `query(text, values)`: a `Pool` (recommended), a
 * `PoolClient` or a `Client`. Every statement below is a single, parameterised
 * SQL statement, so writes stay atomic without holding a connection open.
 */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface PgStorageOptions {
  /** Pool size when the package creates the pool from a connection string. Default 5. */
  poolMax?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RoleRow {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: string[];
  created_at: Date;
  updated_at: Date;
}

const ROLE_SELECT = `
  SELECT r.id::text, r.name, r.description, r.is_system, r.created_at, r.updated_at,
         COALESCE(array_agg(rp.permission ORDER BY rp.permission)
                  FILTER (WHERE rp.permission IS NOT NULL), '{}')::text[] AS permissions
    FROM rbac.roles r
    LEFT JOIN rbac.role_permissions rp ON rp.role_id = r.id
   WHERE r.tenant_id = $1`;

export function createPool(connectionString: string, options: PgStorageOptions = {}): Pool {
  return new Pool({ connectionString, max: options.poolMax ?? 5 });
}

/** Postgres storage over the `rbac` schema created by `migrate()`. */
export function pgStorage(db: Queryable | string, options: PgStorageOptions = {}): RbacStorage {
  const conn: Queryable = typeof db === "string" ? createPool(db, options) : db;

  const query = async <T>(text: string, values: unknown[]): Promise<T[]> => {
    try {
      return (await conn.query(text, values)).rows as T[];
    } catch (err) {
      throw translate(err);
    }
  };

  const getRole = async (tenantId: string, roleId: string): Promise<Role | null> => {
    if (!UUID.test(roleId)) return null;
    const rows = await query<RoleRow>(`${ROLE_SELECT} AND r.id = $2 GROUP BY r.id`, [tenantId, roleId]);
    return rows[0] ? toRole(rows[0]) : null;
  };

  return {
    async getGrants(tenantId, userId, groups) {
      const rows = await query<{ has_system: boolean; permissions: string[] }>(
        `WITH my_roles AS (
           SELECT role_id FROM rbac.user_roles WHERE tenant_id = $1 AND user_id = $2
           UNION
           SELECT role_id FROM rbac.group_roles WHERE tenant_id = $1 AND group_name = ANY($3::text[])
         )
         SELECT COALESCE(bool_or(r.is_system), false) AS has_system,
                COALESCE(array_agg(DISTINCT rp.permission)
                         FILTER (WHERE rp.permission IS NOT NULL), '{}')::text[] AS permissions
           FROM my_roles m
           JOIN rbac.roles r ON r.tenant_id = $1 AND r.id = m.role_id
           LEFT JOIN rbac.role_permissions rp ON rp.role_id = r.id`,
        [tenantId, userId, [...groups]],
      );
      const row = rows[0];
      return { permissions: row?.permissions ?? [], hasSystemRole: row?.has_system ?? false };
    },

    async listRoles(tenantId) {
      const rows = await query<RoleRow>(
        `${ROLE_SELECT} GROUP BY r.id ORDER BY r.is_system DESC, lower(r.name)`,
        [tenantId],
      );
      return rows.map(toRole);
    },

    getRole,

    async createRole(tenantId, input: CreateRoleInput) {
      const rows = await query<{ id: string }>(
        `WITH new_role AS (
           INSERT INTO rbac.roles (tenant_id, name, description, is_system)
           VALUES ($1, $2, $3, $4)
           RETURNING id
         ), perms AS (
           INSERT INTO rbac.role_permissions (tenant_id, role_id, permission)
           SELECT $1, new_role.id, p FROM new_role, unnest($5::text[]) AS p
           ON CONFLICT DO NOTHING
         )
         SELECT id::text FROM new_role`,
        [tenantId, input.name, input.description, input.isSystem ?? false, [...new Set(input.permissions)]],
      );
      const role = await getRole(tenantId, rows[0]!.id);
      return role!;
    },

    async updateRole(tenantId, roleId, input: UpdateRoleInput) {
      if (!UUID.test(roleId)) return null;
      const replacePermissions = input.permissions !== undefined;
      const rows = await query<{ id: string }>(
        `WITH upd AS (
           UPDATE rbac.roles
              SET name = COALESCE($3, name),
                  description = COALESCE($4, description),
                  updated_at = now()
            WHERE tenant_id = $1 AND id = $2
           RETURNING id
         ), del AS (
           DELETE FROM rbac.role_permissions
            WHERE $5::boolean AND tenant_id = $1 AND role_id IN (SELECT id FROM upd)
              AND NOT (permission = ANY($6::text[]))
         ), ins AS (
           INSERT INTO rbac.role_permissions (tenant_id, role_id, permission)
           SELECT $1, upd.id, p FROM upd, unnest($6::text[]) AS p
            WHERE $5::boolean
           ON CONFLICT DO NOTHING
         )
         SELECT id::text FROM upd`,
        [
          tenantId,
          roleId,
          input.name ?? null,
          input.description ?? null,
          replacePermissions,
          [...new Set(input.permissions ?? [])],
        ],
      );
      return rows[0] ? getRole(tenantId, roleId) : null;
    },

    async deleteRole(tenantId, roleId) {
      if (!UUID.test(roleId)) return false;
      const rows = await query(`DELETE FROM rbac.roles WHERE tenant_id = $1 AND id = $2 RETURNING id`, [
        tenantId,
        roleId,
      ]);
      return rows.length > 0;
    },

    async listUserAssignments(tenantId): Promise<UserAssignment[]> {
      const rows = await query<{ user_id: string; role_ids: string[] }>(
        `SELECT user_id, array_agg(role_id::text ORDER BY role_id)::text[] AS role_ids
           FROM rbac.user_roles WHERE tenant_id = $1
          GROUP BY user_id ORDER BY user_id`,
        [tenantId],
      );
      return rows.map((r) => ({ userId: r.user_id, roleIds: r.role_ids }));
    },

    async setUserRoles(tenantId, userId, roleIds) {
      assertUuids(roleIds);
      await query(
        `WITH del AS (
           DELETE FROM rbac.user_roles
            WHERE tenant_id = $1 AND user_id = $2 AND NOT (role_id = ANY($3::uuid[]))
         )
         INSERT INTO rbac.user_roles (tenant_id, user_id, role_id)
         SELECT $1, $2, r FROM unnest($3::uuid[]) AS r
         ON CONFLICT DO NOTHING`,
        [tenantId, userId, [...new Set(roleIds)]],
      );
    },

    async listGroupMappings(tenantId): Promise<GroupMapping[]> {
      const rows = await query<{ group_name: string; role_ids: string[] }>(
        `SELECT group_name, array_agg(role_id::text ORDER BY role_id)::text[] AS role_ids
           FROM rbac.group_roles WHERE tenant_id = $1
          GROUP BY group_name ORDER BY group_name`,
        [tenantId],
      );
      return rows.map((r) => ({ group: r.group_name, roleIds: r.role_ids }));
    },

    async setGroupRoles(tenantId, group, roleIds) {
      assertUuids(roleIds);
      await query(
        `WITH del AS (
           DELETE FROM rbac.group_roles
            WHERE tenant_id = $1 AND group_name = $2 AND NOT (role_id = ANY($3::uuid[]))
         )
         INSERT INTO rbac.group_roles (tenant_id, group_name, role_id)
         SELECT $1, $2, r FROM unnest($3::uuid[]) AS r
         ON CONFLICT DO NOTHING`,
        [tenantId, group, [...new Set(roleIds)]],
      );
    },
  };
}

function toRole(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    permissions: row.permissions,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function assertUuids(ids: readonly string[]) {
  for (const id of ids) {
    if (!UUID.test(id)) throw new RbacError("invalid_request", `Unknown role ${id}`);
  }
}

/** Maps the Postgres errors a caller can cause to `RbacError`; anything else is rethrown. */
function translate(err: unknown): unknown {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "23505") return new RbacError("conflict", "A role with this name already exists");
  if (code === "23503") return new RbacError("invalid_request", "Unknown role");
  return err;
}
