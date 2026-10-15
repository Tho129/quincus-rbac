import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import type { ExpressLikeRequest, ExpressMiddleware } from "../../src/adapters/express";
import { createRbac } from "../../src/rbac";
import { memoryStorage } from "../../src/storage/memory";

/** Identity comes from a test header — stands in for a verified token. */
function setup() {
  const rbac = createRbac({
    permissions: { order: ["view", "edit"] },
    storage: memoryStorage(),
    getUser: (req: Request | undefined) => {
      const raw = req?.headers.get("x-test-user");
      if (!raw) return null;
      const [userId = "", tenantId = ""] = raw.split("@");
      return { userId, tenantId };
    },
    listUsers: async () => [{ id: "u1", name: "Ann" }],
  });
  return rbac;
}

async function call<T = unknown>(
  rbac: ReturnType<typeof setup>,
  method: string,
  path: string,
  opts: { user?: string; body?: unknown } = {},
) {
  const handlers = rbac.nextHandlers();
  const req = new Request(`http://app.test/api/rbac/${path}`, {
    method,
    headers: opts.user ? { "x-test-user": opts.user } : {},
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
  const handler = handlers[method as keyof typeof handlers];
  const res = await handler(req, { params: Promise.resolve({ path: path.split("/").filter(Boolean).map(decodeURIComponent) }) });
  const json = (await res.json()) as { data?: T; error?: { code: string } };
  return { status: res.status, data: json.data as T, error: json.error };
}

test("admin API: 401 when signed out, 403 without rbac:manage", async () => {
  const rbac = setup();
  assert.equal((await call(rbac, "GET", "roles")).status, 401);
  assert.equal((await call(rbac, "GET", "roles", { user: "u1@t1" })).status, 403);
});

test("admin API: GET me works for any signed-in user", async () => {
  const rbac = setup();
  const res = await call(rbac, "GET", "me", { user: "u1@t1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { userId: "u1", tenantId: "t1", groups: [], permissions: [] });
});

test("admin API: role lifecycle and assignments for an admin", async () => {
  const rbac = setup();
  await rbac.admin.seedTenant("t1", "admin");
  const admin = { user: "admin@t1" };

  const perms = await call<{ resource: string }[]>(rbac, "GET", "permissions", admin);
  assert.deepEqual(
    perms.data.map((g) => g.resource),
    ["order", "rbac"],
  );

  const created = await call<{ id: string }>(rbac, "POST", "roles", { ...admin, body: { name: "Viewer", permissions: ["order:view"] } });
  assert.equal(created.status, 201);
  const roleId = created.data.id;

  const patched = await call<{ permissions: string[] }>(rbac, "PATCH", `roles/${roleId}`, { ...admin, body: { permissions: ["order:view", "order:edit"] } });
  assert.deepEqual(patched.data.permissions, ["order:edit", "order:view"]);

  assert.equal((await call(rbac, "PUT", "users/u1/roles", { ...admin, body: { roleIds: [roleId] } })).status, 200);
  const users = await call<{ id: string }[]>(rbac, "GET", "users", admin);
  assert.deepEqual(
    users.data.find((u) => u.id === "u1"),
    { id: "u1", name: "Ann", roleIds: [roleId] },
  );
  const me = await call<{ permissions: string[] }>(rbac, "GET", "me", { user: "u1@t1" });
  assert.deepEqual(me.data.permissions, ["order:view", "order:edit"]);

  assert.equal((await call(rbac, "PUT", "groups/Ops%20Team/roles", { ...admin, body: { roleIds: [roleId] } })).status, 200);
  assert.equal((await call(rbac, "DELETE", "groups/Ops%20Team", admin)).status, 200);
  assert.equal((await call(rbac, "DELETE", `roles/${roleId}`, admin)).status, 200);
  assert.equal((await call(rbac, "GET", `roles/${roleId}`, admin)).status, 404);
});

test("admin API: the tenant comes from the identity, not the request", async () => {
  const rbac = setup();
  await rbac.admin.seedTenant("t1", "admin");
  await rbac.admin.seedTenant("t2", "other");
  const created = await call(rbac, "POST", "roles", {
    user: "other@t2",
    body: { name: "Sneaky", permissions: [], tenantId: "t1" },
  });
  assert.equal(created.status, 201);
  const t1Roles = await call<{ name: string }[]>(rbac, "GET", "roles", { user: "admin@t1" });
  assert.equal(t1Roles.data.some((r) => r.name === "Sneaky"), false);
});

test("admin API: bad input maps to 400/404/409", async () => {
  const rbac = setup();
  await rbac.admin.seedTenant("t1", "admin");
  const admin = { user: "admin@t1" };
  assert.equal((await call(rbac, "POST", "roles", { ...admin, body: "{not json" })).status, 400);
  assert.equal((await call(rbac, "POST", "roles", { ...admin, body: [1] })).status, 400);
  assert.equal((await call(rbac, "POST", "roles", { ...admin, body: { name: "X", permissions: ["nope:x"] } })).status, 400);
  assert.equal((await call(rbac, "GET", "nowhere", admin)).status, 404);
  assert.equal((await call(rbac, "GET", "users/u1/roles/extra", admin)).status, 404);
  assert.equal((await call(rbac, "PUT", "users/admin/roles", { ...admin, body: { roleIds: [] } })).status, 409);
});

test("withPermission answers 401/403 and passes the principal through", async () => {
  const rbac = setup();
  await rbac.admin.seedTenant("t1", "admin");
  const route = rbac.withPermission("order:edit", async (_req, _ctx: unknown, principal) =>
    Response.json({ who: principal.userId }),
  );
  const req = (user?: string) => new Request("http://app.test/x", { headers: user ? { "x-test-user": user } : {} });
  assert.equal((await route(req(), {})).status, 401);
  assert.equal((await route(req("u1@t1"), {})).status, 403);
  const ok = await route(req("admin@t1"), {});
  assert.deepEqual(await ok.json(), { who: "admin" });
});

// --- Express -------------------------------------------------------------

function expressSetup() {
  return createRbac({
    permissions: { order: ["view"] },
    storage: memoryStorage(),
    getUser: (req?: { headers: Record<string, string | undefined> }) => {
      const raw = req?.headers["x-test-user"];
      return raw ? { userId: raw, tenantId: "t1" } : null;
    },
  });
}

function fakeRes() {
  const res = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.payload = body;
      return res;
    },
  };
  return res;
}

function fakeReq(method: string, path: string, user?: string, rawBody?: string) {
  const stream = Readable.from(rawBody === undefined ? [] : [Buffer.from(rawBody)]);
  return Object.assign(stream, { method, path, headers: { "x-test-user": user } });
}

async function runMiddleware(mw: ExpressMiddleware, req: unknown) {
  const res = fakeRes();
  let nextCalled = false;
  let nextErr: unknown;
  await new Promise<void>((resolve) => {
    const done = res.json.bind(res);
    res.json = (body: unknown) => {
      const r = done(body);
      resolve();
      return r;
    };
    mw(req as ExpressLikeRequest, res, (err) => {
      nextCalled = true;
      nextErr = err;
      resolve();
    });
  });
  return { res, nextCalled, nextErr };
}

test("expressRouter serves the admin API and reads an unparsed JSON body", async () => {
  const rbac = expressSetup();
  await rbac.admin.seedTenant("t1", "admin");
  const router = rbac.expressRouter();

  const created = await runMiddleware(
    router,
    fakeReq("POST", "/roles", "admin", JSON.stringify({ name: "Viewer", permissions: ["order:view"] })),
  );
  assert.equal(created.res.statusCode, 201);

  const denied = await runMiddleware(router, fakeReq("GET", "/roles", "someone"));
  assert.equal(denied.res.statusCode, 403);

  const parsed = Object.assign(fakeReq("POST", "/roles", "admin"), { body: { name: "Editor", permissions: [] } });
  assert.equal((await runMiddleware(router, parsed)).res.statusCode, 201, "uses req.body from express.json()");
});

test("expressRequire sets req.rbac or answers 401/403", async () => {
  const rbac = expressSetup();
  await rbac.admin.seedTenant("t1", "admin");
  const guard = rbac.expressRequire("order:view");

  const anon = await runMiddleware(guard, fakeReq("GET", "/orders"));
  assert.equal(anon.res.statusCode, 401);
  const denied = await runMiddleware(guard, fakeReq("GET", "/orders", "someone"));
  assert.equal(denied.res.statusCode, 403);

  const req = fakeReq("GET", "/orders", "admin") as ReturnType<typeof fakeReq> & { rbac?: { userId: string } };
  const allowed = await runMiddleware(guard, req);
  assert.equal(allowed.nextCalled, true);
  assert.equal(allowed.nextErr, undefined);
  assert.equal(req.rbac?.userId, "admin");
});
