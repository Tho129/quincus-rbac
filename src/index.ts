export { createRbac, type Rbac, type RbacOptions } from "./rbac";
export { RBAC_MANAGE, buildCatalog, type Catalog, type CatalogGroup, type PermissionKey, type PermissionMap } from "./catalog";
export { RbacError, isRbacError, errorBody, type RbacErrorCode } from "./errors";
export { parseGroups } from "./groups";
export { createAdmin, seedTenantAdmin, type AdminContext, type RbacAdmin, type RoleInput, type RolePatch, type TenantUserWithRoles } from "./admin";
export { handleAdminHttp, type HttpInput, type HttpResult } from "./http";
export { migrate, applyMigrations, MIGRATIONS } from "./migrations";
export { pgStorage, createPool, type Queryable, type PgStorageOptions } from "./storage/pg";
export { memoryStorage } from "./storage/memory";
export type { RbacStorage, CreateRoleInput, UpdateRoleInput } from "./storage/types";
export type { NextAdminHandlers } from "./adapters/next";
export type { ExpressLikeRequest, ExpressLikeResponse, ExpressMiddleware, ExpressNext } from "./adapters/express";
export type {
  RbacUser,
  Principal,
  Role,
  UserAssignment,
  GroupMapping,
  TenantUser,
  RbacChangeEvent,
} from "./types";
