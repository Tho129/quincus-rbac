# @quincusdev/rbac

> **Status:** Living · **Updated:** 2026-10-15
>
> Multi-tenant role-based access control for Quincus Node.js apps: a permission engine, Postgres storage with migrations, an admin REST API, Next.js / Express adapters, and a themeable React admin UI.

**MVP (v0.1).** See [Not built yet](#not-built-yet) for what is still missing.

## How it works

```
App (verifies the caller its own way: Cognito, JWT, session…)
   │  getUser(req) → { userId, tenantId, groups? }        ← already verified
   ▼
@quincusdev/rbac ── roles (direct + via IdP group) in that tenant ──▶ permissions
   │
   ├─ rbac.require("order:edit", req) → Principal, or RbacError 401/403
   ├─ rbac.can("order:edit", req)     → boolean
   └─ admin API (/roles, /users, /groups…) gated by rbac:manage
```

- **The package does not verify tokens.** The app does, in `getUser`, and
  passes the verified identity. So there are no auth dependencies, and no auth
  env vars on the package side.
- **Multi-tenant by design.** Every row carries `tenant_id`. The tenant always
  comes from the verified identity, never from the request body or query.
- **Least privilege.** A user with no role has no permissions.
- **Role sources.** A user gets roles directly (`userId → role`) and through
  IdP groups (`group → role`); their permissions are the union of both.
- **System role.** Each tenant has one built-in "Admin" role. It grants every
  permission, including ones added to the app later, and cannot be edited or
  deleted.
- **`rbac:manage`.** This permission gates the admin API. The package refuses
  any change that would leave a tenant with no administrator.
- **When changes take effect.** On the next request. Resolved permissions are
  cached per process for `cacheTtlMs` (default 5 s), and admin writes clear
  that tenant's cache in the writing process immediately.

## Install

Requires Node 20+ and Postgres 13+. The package is published to GitHub
Packages, so the app needs an `.npmrc`:

```
@quincusdev:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

Set `NPM_TOKEN` (a GitHub token with `read:packages`) locally, in CI and on Vercel. Then:

```bash
npm i @quincusdev/rbac pg
```

`react` (18+) is an optional peer dependency, needed only for the admin UI.

**To try it before it is published,** build a tarball from this repo and
install that in the other app:

```bash
npm ci && npm run build && npm pack   # → quincusdev-rbac-0.1.0.tgz
cd /path/to/other-app && npm i /path/to/quincusdev-rbac-0.1.0.tgz pg
```

## Integrate in an app

### 1. Create the tables

```bash
DATABASE_URL=postgres://… npx quincus-rbac migrate
```

Add this command to the deploy/build step; it is idempotent and safe to run
on every deploy. It creates the `rbac` schema: `roles`, `role_permissions`,
`user_roles`, `group_roles` and `schema_migrations`. The DB user needs
`CREATE` on the database the first time. You can also call
`migrate(poolOrUrl)` from code.

### 2. Configure: `lib/rbac.ts`

```ts
import { createRbac } from "@quincusdev/rbac";
import { pool } from "./db"; // reuse the app's pg Pool (on serverless: point it at a pooler)

export const rbac = createRbac({
  // Keys are inferred ("order:view" | "order:edit" | "invoice:view" | "rbac:manage"); no `as const` needed.
  permissions: {
    order: {
      label: "Orders", // shown in the admin UI
      actions: {
        view: "View orders",
        edit: { label: "Edit orders", description: "Change quantities and dates" },
      },
    },
    invoice: ["view"], // short form: labels are derived ("View invoice")
  },
  database: pool, // or a connection string
  getUser: async (req?: Request) => {
    // Return the VERIFIED identity, or null when signed out. See "getUser recipes".
  },
  listUsers: async (tenantId) => [], // optional: users offered by the admin API when assigning roles
  onChange: async (event) => {},     // optional: write admin changes to the app's audit log
});
```

### 3. Make the first administrator of each tenant

The default is no access for anyone, so each tenant needs one administrator
to start with. Do one of:

```bash
npx quincus-rbac grant-admin --tenant <tenantId> --user <sub>
```

- call `await rbac.admin.seedTenant(tenantId, userId)` in the app's
  tenant-creation flow;
- or map an IdP group to the system role through the admin API.

### 4. Guard the backend

```ts
// Next.js route handler
export const POST = rbac.withPermission("order:edit", async (req, ctx, principal) => {
  // principal = { userId, tenantId, groups, permissions }
  return Response.json({ ok: true });
});

// Or, inside any handler / server action:
const principal = await rbac.require("order:edit", req); // throws RbacError (401/403)
if (await rbac.can("invoice:view", req)) { /* … */ }

// Express
app.get("/orders", rbac.expressRequire("order:view"), (req, res) => {
  res.json({ by: req.rbac.userId });
});
```

### 5. Mount the admin API

```ts
// Next.js: app/api/rbac/[...path]/route.ts
import { rbac } from "@/lib/rbac";
export const { GET, POST, PUT, PATCH, DELETE } = rbac.nextHandlers();

// Express
app.use("/api/rbac", rbac.expressRouter());
```

### 6. Add the management page

```tsx
// app/admin/roles/page.tsx (Next.js) — or any route of a React app
import { RbacAdmin } from "@quincusdev/rbac/react";
import "@quincusdev/rbac/styles.css";

export default function RolesPage() {
  return <RbacAdmin apiBase="/api/rbac" />;
}
```

Then link to that route from the app's own menu (sidebar, settings…). The
package ships a page, not a navigation.

### 7. Hide what the user cannot do (optional)

```tsx
// app/layout.tsx (server component): hand the caller's permissions to the client
import { RbacProvider } from "@quincusdev/rbac/react";
const me = await rbac.identify();
<RbacProvider initial={me}>{children}</RbacProvider>

// any client component
import { Can, usePermissions } from "@quincusdev/rbac/react";
<Can perm="order:edit"><EditButton /></Can>
<Can perm={["invoice:view", "report:view"]} any fallback={<span>No access</span>}>…</Can>
const { can } = usePermissions();
if (can("order:delete")) { /* … */ }
```

Without `initial`, `<RbacProvider>` loads `GET me` from the admin API on
mount; `refresh()` re-reads it. This only hides UI: the server must still
guard every action with `rbac.require()`.

### Env vars an app needs

| Env | Needed |
|---|---|
| `DATABASE_URL` (or the app's own pool config) | always |
| `NPM_TOKEN` | to install the private package |
| Whatever the app's auth needs (e.g. `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`) | the app's concern, not the package's |

## `getUser` recipes

**Security rule:** return only identity you verified (a token signature or a
session lookup). Never take `userId` or `tenantId` from the body, query or a
header the client sets.

`req` is whatever the app passes to `require` / `can` / `identify`. It is
`undefined` when called without one, for example from a Next.js server
action, where `getUser` reads `headers()` / `cookies()` itself.

**Cognito access token** (with `tenant_id` and `idp_groups` claims):

```ts
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { headers } from "next/headers";

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  clientId: process.env.COGNITO_CLIENT_ID!,
  tokenUse: "access",
});

getUser: async (req?: Request) => {
  const auth = req ? req.headers.get("authorization") : (await headers()).get("authorization");
  const token = auth?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const claims = await verifier.verify(token); // signature (JWKS), exp, iss, client_id, token_use
    return { userId: claims.sub, tenantId: String(claims.tenant_id), groups: claims.idp_groups };
  } catch {
    return null;
  }
},
```

`groups` accepts `string[]`, Cognito's `"A"` / `"[A, B]"` strings, or JSON.

**Self-issued JWT** (e.g. with `jose`):

```ts
const { payload } = await jwtVerify(token, secret, { issuer: "my-app" });
return { userId: payload.sub!, tenantId: payload.org_id as string, groups: payload.roles };
```

**Session / anything else:** call the app's own auth helper and map its result to `{ userId, tenantId, groups }`.

## Admin API

The routes below are relative to the mount point. Every route needs
`rbac:manage` except `GET me`, and every route is confined to the caller's
tenant. Responses are `{ data }` or `{ error: { code, message } }`, with
status 400, 401, 403, 404 or 409.

| Route | Body | Returns |
|---|---|---|
| `GET me` | | `{ userId, tenantId, groups, permissions }` (for hiding UI) |
| `GET permissions` | | catalog grouped by resource |
| `GET roles` | | roles with permissions |
| `POST roles` | `{ name, description?, permissions }` | the role (201) |
| `GET roles/:id` | | the role |
| `PATCH roles/:id` | `{ name?, description?, permissions? }` | the role |
| `DELETE roles/:id` | | `{ deleted: true }` |
| `GET users` | | `listUsers()` merged with assignments: `{ id, name?, email?, roleIds }[]` |
| `PUT users/:userId/roles` | `{ roleIds }` | replaces the user's direct roles |
| `GET groups` | | `{ group, roleIds }[]` |
| `PUT groups/:group/roles` | `{ roleIds }` | replaces the group's roles |
| `DELETE groups/:group` | | removes the mapping |

The same operations are available in code as
`rbac.admin.<op>({ tenantId, actorId }, …)`, for example in server actions.
Callers using them directly must check `rbac:manage` themselves.

## Admin UI

`<RbacAdmin />` is the whole page. It has four tabs, ported from Manifold's
`/settings/roles` and `/settings/permissions`:

| Tab | What it does |
|---|---|
| Roles | List roles; add (optionally copying another role's permissions), rename, describe, delete. The system role is read-only. |
| Permissions | Roles × permissions matrix grouped by resource, as toggles; "All on / All off" per role; collapsible groups; a sticky "unsaved changes" bar. Turning an action on also turns on that resource's `view`, and turning `view` off turns off the rest of the resource. |
| Users | Users from `listUsers` plus anyone holding a role; search; edit a user's roles; "Assign by user ID" for users the app does not list. |
| IdP groups | Map an identity-provider group name to roles; edit; remove. |

- Users without `rbac:manage` see a "You don't have access" panel. Every
  change goes through the admin API, which enforces the same rules (including
  "keep at least one administrator").
- **Props.** `apiBase` (default `/api/rbac`); `getHeaders` (e.g. an
  `Authorization` header when the app's auth is a bearer token, not a cookie);
  `fetch`; `labels` (any UI text; see `DEFAULT_LABELS`, English by default);
  `tabs` / `defaultTab`; `hideHeader`; `className`.
- **Building your own layout.** Wrap any of `<RolesManager />`,
  `<PermissionsMatrix />`, `<UserRoles />`, `<GroupMappings />` in
  `<RbacAdminProvider apiBase=…>`. `createRbacApi()` is the typed API client.
- **Theme.** The theme is light. All styles are in `styles.css`, every class
  is prefixed `rbac-`, and nothing outside `.rbac-root` is touched. Re-theme by
  overriding variables:

  ```css
  .rbac-root {
    --rbac-primary: #0f766e;
    --rbac-primary-hover: #115e59;
    --rbac-primary-soft: #f0fdfa;
    --rbac-radius: 4px;
    --rbac-font: "Inter", sans-serif;
  }
  ```

  The other variables are `--rbac-bg`, `--rbac-surface`, `--rbac-border`,
  `--rbac-text`, `--rbac-muted`, `--rbac-danger`, `--rbac-warning` and
  `--rbac-success`; see the top of `styles.css`.
- The UI has no dependencies besides React: no Tailwind, no component library,
  inline SVG icons. `@quincusdev/rbac/react` is a client entry (`"use client"`)
  and never loads `pg`.

## Example app

`example/` is a small Next.js app that uses the package the way a real app
does. It has its own sidebar with a link to the RBAC page, a guarded "Orders"
page, and a "Signed in as" switcher across demo users in two tenants. It uses
in-memory storage, so it needs no database. With Node 20+:

```bash
npm ci && npm run example
```

Then open http://localhost:3100.

- **alice** (acme) is the administrator.
- **bob** has the "Order viewer" role.
- **carol** has no direct role; she gets "Finance" through the IdP group
  `Finance`.
- **dave** is the administrator of another tenant (globex), and sees none of
  acme's roles.

The sign-in switcher is a plain cookie for the demo only.

## API summary

| | |
|---|---|
| `createRbac(options)` | `permissions`, `getUser`, `database` \| `storage`, `listUsers?`, `onChange?`, `cacheTtlMs?` (5000), `poolMax?` (5) |
| `rbac.identify(req?)` | `Principal \| null` |
| `rbac.require(perm \| perm[], req?)` | `Principal`; throws `RbacError` 401/403 |
| `rbac.can(perm, req?)` | `boolean` |
| `rbac.has(principal, perm)` | sync check |
| `rbac.resolve(user)` | permissions for an identity the app already has |
| `rbac.invalidate(tenantId?)` | drop cached permissions |
| `rbac.nextHandlers()` / `rbac.withPermission()` | Next.js |
| `rbac.expressRouter()` / `rbac.expressRequire()` | Express |
| `migrate(urlOrPool)`, `memoryStorage()`, `pgStorage()` | setup / tests |
| `@quincusdev/rbac/react` | `RbacAdmin`, `RbacAdminProvider`, `RolesManager`, `PermissionsMatrix`, `UserRoles`, `GroupMappings`, `RbacProvider`, `usePermissions`, `Can`, `createRbacApi`, `DEFAULT_LABELS` |

For an app's own tests, use `storage: memoryStorage()`; it needs no database.

## Develop

```bash
npm ci
npm run typecheck      # package + example app
npm test               # unit tests (memory storage, adapters, UI logic)
DATABASE_URL=… npm run test:db   # same storage contract against Postgres; each case rolls back
npm run build          # → dist/
```

CI (`.github/workflows/ci.yml`) runs on every PR and push to `main`:
typecheck, unit tests, DB tests against Postgres 16, build and a pack dry run.

## Release

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry, in a PR.
2. After it merges, tag `main` with `v<version>` and push the tag:

   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```

3. CI re-runs the checks and publishes to GitHub Packages with the workflow's
   `GITHUB_TOKEN`; no secret needs to be configured. The tag must equal `v` +
   the `package.json` version, or the publish step fails.

The package is private to the QuincusDev org (`access: restricted`). The repo
of an app that installs it in GitHub Actions needs read access to the package:
**Package settings → Manage Actions access**.

## Not built yet

- Component tests for the UI. Its pure logic is unit-tested, and the screens
  were checked by hand in `example/`.
- Manifold (where the UI and rules come from) still uses its own built-in RBAC.
