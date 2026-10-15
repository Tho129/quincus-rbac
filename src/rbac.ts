import { createAdmin, type RbacAdmin } from "./admin";
import { PermissionCache } from "./cache";
import { buildCatalog, type Catalog, type PermissionKey, type PermissionMap } from "./catalog";
import { RbacError } from "./errors";
import { parseGroups } from "./groups";
import { handleAdminHttp, toHttpError, type HttpInput, type HttpResult } from "./http";
import { nextAdminHandlers, nextWithPermission, type NextAdminHandlers } from "./adapters/next";
import {
  expressAdminRouter,
  expressRequirePermission,
  type ExpressLikeRequest,
  type ExpressMiddleware,
} from "./adapters/express";
import { pgStorage, type Queryable } from "./storage/pg";
import type { RbacStorage } from "./storage/types";
import type { Principal, RbacChangeEvent, RbacUser, TenantUser } from "./types";

export interface RbacOptions<P extends PermissionMap, Req> {
  /** The app's permissions: `{ order: ["view", "edit"] }` → `order:view`, `order:edit`. */
  permissions: P;
  /**
   * Returns the verified identity behind a request, or null when signed out.
   * `req` is whatever the app passes to `require`/`can`/`identify` — undefined
   * when called without one (e.g. from a Next.js server action, where the app
   * reads `headers()`/`cookies()` itself).
   */
  getUser: (req: Req | undefined) => RbacUser | null | undefined | Promise<RbacUser | null | undefined>;
  /** A pg `Pool` (recommended — reuse the app's) or a connection string. Ignored when `storage` is set. */
  database?: Queryable | string;
  /** Custom storage, e.g. `memoryStorage()` in tests. */
  storage?: RbacStorage;
  /** The tenant's users, offered by the admin API/UI when assigning roles. */
  listUsers?: (tenantId: string) => Promise<TenantUser[]>;
  /** Called after every admin change — hook for the app's audit log. */
  onChange?: (event: RbacChangeEvent) => void | Promise<void>;
  /** How long resolved permissions are cached per process. Default 5000 ms; 0 disables. */
  cacheTtlMs?: number;
  /** Pool size when `database` is a connection string. Default 5. */
  poolMax?: number;
}

export interface Rbac<K extends string, Req> {
  readonly catalog: Catalog;
  readonly storage: RbacStorage;
  /** Role/permission management operations, for server actions or custom APIs. */
  readonly admin: RbacAdmin;

  /** The verified caller with their permissions, or null when signed out. */
  identify(req?: Req): Promise<Principal | null>;
  /** Permissions of a known identity (when the app already has the user). */
  resolve(user: RbacUser): Promise<Principal>;
  /** The caller if they hold every listed permission; otherwise throws `RbacError` (401/403). */
  require(permission: K | readonly K[], req?: Req): Promise<Principal>;
  /** Whether the caller holds the permission. Never throws for signed-out callers. */
  can(permission: K, req?: Req): Promise<boolean>;
  /** Synchronous check on a principal you already resolved. */
  has(principal: Principal, permission: K): boolean;
  /** Drops cached permissions — one tenant, or everything. */
  invalidate(tenantId?: string): void;

  /** The admin REST API, framework-independent (see `handleAdminHttp`). */
  handle(req: Req | undefined, input: HttpInput): Promise<HttpResult>;
  /** Next.js route handlers for `app/api/rbac/[...path]/route.ts`. */
  nextHandlers(): NextAdminHandlers;
  /** Next.js route handler wrapper that answers 401/403 itself. */
  withPermission<Ctx>(
    permission: K | readonly K[],
    handler: (req: Request, ctx: Ctx, principal: Principal) => Response | Promise<Response>,
  ): (req: Request, ctx: Ctx) => Promise<Response>;
  /** Express middleware serving the admin API: `app.use("/api/rbac", rbac.expressRouter())`. */
  expressRouter(): ExpressMiddleware;
  /** Express guard middleware; sets `req.rbac` to the principal. */
  expressRequire(permission: K | readonly K[]): ExpressMiddleware;
}

export function createRbac<const P extends PermissionMap, Req = Request>(
  options: RbacOptions<P, Req>,
): Rbac<PermissionKey<P>, Req> {
  const catalog = buildCatalog(options.permissions);
  const storage = options.storage ?? createStorage(options);
  const cache = new PermissionCache(options.cacheTtlMs ?? 5000);
  const admin = createAdmin({
    storage,
    catalog,
    listUsers: options.listUsers,
    onChange: options.onChange,
    invalidate: (tenantId) => cache.invalidate(tenantId),
  });

  const resolve = async (user: RbacUser): Promise<Principal> => {
    if (!isNonEmptyString(user.userId) || !isNonEmptyString(user.tenantId)) {
      throw new RbacError("unauthenticated", "getUser must return a non-empty userId and tenantId");
    }
    const groups = parseGroups(user.groups);
    let permissions = cache.get(user.tenantId, user.userId, groups);
    if (!permissions) {
      const grants = await storage.getGrants(user.tenantId, user.userId, groups);
      const granted = new Set(grants.permissions);
      // Catalog order, catalog keys only: a permission an app has since
      // removed from its code grants nothing even if a role still lists it.
      permissions = catalog.keys.filter((k) => grants.hasSystemRole || granted.has(k));
      cache.set(user.tenantId, user.userId, groups, permissions);
    }
    return { userId: user.userId, tenantId: user.tenantId, groups, permissions: [...permissions] };
  };

  const identify = async (req?: Req): Promise<Principal | null> => {
    const user = await options.getUser(req);
    return user ? resolve(user) : null;
  };

  const require = async (permission: PermissionKey<P> | readonly PermissionKey<P>[], req?: Req) => {
    const principal = await identify(req);
    if (!principal) throw new RbacError("unauthenticated", "Not signed in");
    const wanted: readonly string[] = typeof permission === "string" ? [permission] : permission;
    const missing = wanted.filter((p) => !principal.permissions.includes(p));
    if (missing.length) throw new RbacError("forbidden", `Missing permission ${missing.join(", ")}`);
    return principal;
  };

  const handle = async (req: Req | undefined, input: HttpInput): Promise<HttpResult> => {
    let principal: Principal | null;
    try {
      principal = await identify(req);
    } catch (err) {
      if (!(err instanceof RbacError)) return toHttpError(err);
      principal = null; // a malformed identity is treated as signed out
    }
    return handleAdminHttp(principal, admin, input);
  };

  return {
    catalog,
    storage,
    admin,
    identify,
    resolve,
    require,
    async can(permission, req) {
      const principal = await identify(req);
      return principal ? principal.permissions.includes(permission) : false;
    },
    has: (principal, permission) => principal.permissions.includes(permission),
    invalidate: (tenantId) => cache.invalidate(tenantId),
    handle,
    nextHandlers: () => nextAdminHandlers((req, input) => handle(req as unknown as Req, input)),
    withPermission: (permission, handler) =>
      nextWithPermission((req) => require(permission, req as unknown as Req), handler),
    expressRouter: () => expressAdminRouter((req, input) => handle(req as unknown as Req, input)),
    expressRequire: (permission) =>
      expressRequirePermission((req: ExpressLikeRequest) => require(permission, req as unknown as Req)),
  };
}

function createStorage(options: { database?: Queryable | string; poolMax?: number }): RbacStorage {
  if (!options.database) throw new Error("rbac: pass `database` (a pg Pool or connection string) or `storage`");
  return pgStorage(options.database, { poolMax: options.poolMax });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
