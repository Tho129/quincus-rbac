export type RbacErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_request"
  | "not_found"
  | "conflict";

const STATUS: Record<RbacErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
};

/**
 * The one error type the package throws on purpose. `status` is the HTTP
 * status the adapters answer with, so a route can `catch` it and reply
 * without mapping codes itself.
 */
export class RbacError extends Error {
  readonly code: RbacErrorCode;
  readonly status: number;

  constructor(code: RbacErrorCode, message: string) {
    super(message);
    this.name = "RbacError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isRbacError(err: unknown): err is RbacError {
  return err instanceof RbacError;
}

export function errorBody(err: RbacError): { error: { code: RbacErrorCode; message: string } } {
  return { error: { code: err.code, message: err.message } };
}
