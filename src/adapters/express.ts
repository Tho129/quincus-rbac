import { RbacError, errorBody, isRbacError } from "../errors";
import type { HttpInput, HttpResult } from "../http";
import type { Principal } from "../types";

/** The parts of an Express request the adapter uses (structural — no express dependency). */
export interface ExpressLikeRequest {
  method: string;
  path: string;
  body?: unknown;
  readableEnded?: boolean;
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
}

export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  json(body: unknown): unknown;
}

export type ExpressNext = (err?: unknown) => void;
export type ExpressMiddleware = (req: ExpressLikeRequest, res: ExpressLikeResponse, next: ExpressNext) => void;

const MAX_BODY_BYTES = 1_000_000;

/**
 * Middleware serving the admin API under its mount path:
 *
 *   app.use("/api/rbac", rbac.expressRouter());
 *
 * Uses `req.body` when a JSON body parser already ran, else reads the body itself.
 */
export function expressAdminRouter(
  handle: (req: ExpressLikeRequest, input: HttpInput) => Promise<HttpResult>,
): ExpressMiddleware {
  return (req, res, next) => {
    (async () => {
      let path: string[];
      try {
        path = req.path.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
      } catch {
        return send(res, { status: 400, body: errorBody(new RbacError("invalid_request", "Malformed path")) });
      }
      let body = req.body;
      if (body === undefined && req.method !== "GET" && req.method !== "DELETE") {
        try {
          body = await readJson(req);
        } catch (err) {
          if (isRbacError(err)) return send(res, { status: err.status, body: errorBody(err) });
          throw err;
        }
      }
      send(res, await handle(req, { method: req.method, path, body }));
    })().catch(next);
  };
}

/**
 * Guards a route: `app.get("/orders", rbac.expressRequire("order:view"), handler)`.
 * On success the principal is on `req.rbac`.
 */
export function expressRequirePermission(
  require: (req: ExpressLikeRequest) => Promise<Principal>,
): ExpressMiddleware {
  return (req, res, next) => {
    require(req).then(
      (principal) => {
        (req as ExpressLikeRequest & { rbac?: Principal }).rbac = principal;
        next();
      },
      (err) => {
        if (isRbacError(err)) send(res, { status: err.status, body: errorBody(err) });
        else next(err);
      },
    );
  };
}

function send(res: ExpressLikeResponse, result: HttpResult) {
  res.status(result.status).json(result.body);
}

async function readJson(req: ExpressLikeRequest): Promise<unknown> {
  const iterate = req[Symbol.asyncIterator];
  if (!iterate || req.readableEnded) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as unknown as AsyncIterable<Buffer | string>) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new RbacError("invalid_request", "Request body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new RbacError("invalid_request", "Request body is not valid JSON");
  }
}
