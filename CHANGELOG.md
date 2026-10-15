# Changelog

> **Status:** Living · **Updated:** 2026-10-15
>
> Released versions of `@quincusdev/rbac`. Add an entry with every version bump.

## 0.1.0 — 2026-10-15

First release.

- **Engine.** `createRbac()` with `require` / `can` / `identify` / `has`.
  Identity comes from the app's `getUser()` (`{ userId, tenantId, groups }`).
  Least privilege by default.
- **Permission catalog.** Declared per app, either as a list of actions or with
  labels and descriptions. `rbac:manage` is built in.
- **Multi-tenant storage.** Postgres storage in the `rbac` schema, with
  migrations (`npx quincus-rbac migrate`). In-memory storage for tests.
- **Role sources.** Roles assigned directly and through IdP groups (Cognito
  `idp_groups`: `"A"` / `"[A, B]"`). Each tenant has a system role, and a
  tenant can never lose its last administrator.
- **Cache.** Per-process permission cache (default 5 s), cleared on admin
  changes.
- **Admin API and adapters.** Admin REST API, Next.js adapter
  (`nextHandlers`, `withPermission`) and Express adapter (`expressRouter`,
  `expressRequire`).
- **CLI.** `quincus-rbac migrate`, `quincus-rbac grant-admin`.
- **React UI.** `<RbacAdmin />` (roles, permission matrix, users, IdP groups):
  light theme, themeable through `--rbac-*` CSS variables, translatable
  labels. `<RbacProvider>`, `usePermissions()` and `<Can>` hide UI by
  permission.
