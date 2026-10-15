import { RbacError, errorBody, isRbacError } from "../errors";
import type { HttpInput, HttpResult } from "../http";
import { toHttpError } from "../http";
import type { Principal } from "../types";

type Params = { params: Promise<{ path?: string[] }> };
type NextHandler = (req: Request, ctx: Params) => Promise<Response>;

export interface NextAdminHandlers {
  GET: NextHandler;
  POST: NextHandler;
  PUT: NextHandler;
  PATCH: NextHandler;
  DELETE: NextHandler;
}

/**
 * Route handlers for `app/<mount>/[...path]/route.ts`:
 *
 *   export const { GET, POST, PUT, PATCH, DELETE } = rbac.nextHandlers();
 */
export function nextAdminHandlers(
  handle: (req: Request, input: HttpInput) => Promise<HttpResult>,
): NextAdminHandlers {
  const handler: NextHandler = async (req, ctx) => {
    const { path = [] } = await ctx.params;
    let body: unknown;
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE") {
      const text = await req.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          return json(toHttpError(new RbacError("invalid_request", "Request body is not valid JSON")));
        }
      }
    }
    return json(await handle(req, { method: req.method, path, body }));
  };
  return { GET: handler, POST: handler, PUT: handler, PATCH: handler, DELETE: handler };
}

/**
 * Wraps a route handler so it only runs for callers holding `permission`;
 * others get a 401/403 JSON response.
 */
export function nextWithPermission<Ctx>(
  require: (req: Request) => Promise<Principal>,
  handler: (req: Request, ctx: Ctx, principal: Principal) => Response | Promise<Response>,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    let principal: Principal;
    try {
      principal = await require(req);
    } catch (err) {
      if (isRbacError(err)) return json({ status: err.status, body: errorBody(err) });
      throw err;
    }
    return handler(req, ctx, principal);
  };
}

function json(result: HttpResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
