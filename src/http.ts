import type { RbacAdmin } from "./admin";
import { RBAC_MANAGE } from "./catalog";
import { RbacError, errorBody, isRbacError } from "./errors";
import type { Principal } from "./types";

export interface HttpInput {
  method: string;
  /** Path segments below the mount point, e.g. `["roles", "<id>"]`. */
  path: string[];
  body?: unknown;
}

export interface HttpResult {
  status: number;
  body: unknown;
}

/**
 * The admin REST API, independent of any framework. All routes except
 * `GET me` need `rbac:manage`; all are confined to the caller's tenant —
 * the tenant always comes from the verified principal, never the request.
 *
 *   GET    me                    → the caller's userId, tenantId, groups, permissions
 *   GET    permissions           → the app's permission catalog, grouped by resource
 *   GET    roles                 → roles with their permissions
 *   POST   roles                 → create { name, description?, permissions }
 *   GET    roles/:id
 *   PATCH  roles/:id             → { name?, description?, permissions? }
 *   DELETE roles/:id
 *   GET    users                 → users (from listUsers) with their direct roleIds
 *   PUT    users/:userId/roles   → { roleIds }
 *   GET    groups                → IdP group → roleIds mappings
 *   PUT    groups/:group/roles   → { roleIds }   (empty list removes the mapping)
 *   DELETE groups/:group
 */
export async function handleAdminHttp(
  principal: Principal | null,
  admin: RbacAdmin,
  input: HttpInput,
): Promise<HttpResult> {
  try {
    if (!principal) throw new RbacError("unauthenticated", "Not signed in");
    const method = input.method.toUpperCase();
    const path = input.path.filter(Boolean);
    const route =
      path.length > 3
        ? ""
        : `${method} ${path[0] ?? ""}${path.length > 1 ? "/:id" : ""}${path.length > 2 ? `/${path[2]}` : ""}`;
    const id = path[1] ?? "";

    if (route === "GET me") {
      const { userId, tenantId, groups, permissions } = principal;
      return ok({ userId, tenantId, groups, permissions });
    }

    if (!principal.permissions.includes(RBAC_MANAGE)) {
      throw new RbacError("forbidden", `Missing permission ${RBAC_MANAGE}`);
    }
    const ctx = { tenantId: principal.tenantId, actorId: principal.userId };
    const body = asObject(input.body);

    switch (route) {
      case "GET permissions":
        return ok(admin.listPermissions());
      case "GET roles":
        return ok(await admin.listRoles(ctx));
      case "POST roles":
        return ok(
          await admin.createRole(ctx, {
            name: body.name as string,
            description: body.description as string | undefined,
            permissions: body.permissions as string[],
          }),
          201,
        );
      case "GET roles/:id":
        return ok(await admin.getRole(ctx, id));
      case "PATCH roles/:id":
        return ok(
          await admin.updateRole(ctx, id, {
            name: body.name as string | undefined,
            description: body.description as string | undefined,
            permissions: body.permissions as string[] | undefined,
          }),
        );
      case "DELETE roles/:id":
        await admin.deleteRole(ctx, id);
        return ok({ deleted: true });
      case "GET users":
        return ok(await admin.listUsers(ctx));
      case "PUT users/:id/roles":
        await admin.setUserRoles(ctx, id, body.roleIds);
        return ok({ userId: id, roleIds: body.roleIds });
      case "GET groups":
        return ok(await admin.listGroups(ctx));
      case "PUT groups/:id/roles":
        await admin.setGroupRoles(ctx, id, body.roleIds);
        return ok({ group: id, roleIds: body.roleIds });
      case "DELETE groups/:id":
        await admin.setGroupRoles(ctx, id, []);
        return ok({ deleted: true });
      default:
        throw new RbacError("not_found", `No route ${method} /${path.join("/")}`);
    }
  } catch (err) {
    return toHttpError(err);
  }
}

export function toHttpError(err: unknown): HttpResult {
  if (isRbacError(err)) return { status: err.status, body: errorBody(err) };
  console.error("rbac: unexpected error", err);
  return { status: 500, body: { error: { code: "internal", message: "Internal error" } } };
}

function ok(data: unknown, status = 200): HttpResult {
  return { status, body: { data } };
}

function asObject(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new RbacError("invalid_request", "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}
