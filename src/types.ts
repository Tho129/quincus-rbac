/**
 * What the app's `getUser` returns: an identity the app has ALREADY verified
 * (token signature, session lookup, …). Never build it from request body,
 * query or headers the client controls.
 */
export interface RbacUser {
  userId: string;
  tenantId: string;
  /** IdP groups — `string[]`, `"A"`, `"[A, B]"` or JSON; see `parseGroups`. */
  groups?: unknown;
}

/** A verified user together with the permissions they hold in their tenant. */
export interface Principal {
  userId: string;
  tenantId: string;
  groups: string[];
  permissions: string[];
}

export interface Role {
  id: string;
  name: string;
  description: string;
  /** A system role grants every permission, now and in future; it cannot be edited or deleted. */
  isSystem: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserAssignment {
  userId: string;
  roleIds: string[];
}

export interface GroupMapping {
  group: string;
  roleIds: string[];
}

/** A user the app knows about, offered by the admin API when assigning roles. */
export interface TenantUser {
  id: string;
  name?: string;
  email?: string;
  /**
   * The user's IdP groups, when the app knows them (`string[]`, or Cognito's
   * `"A"` / `"[A, B]"`). Lets the admin UI show the roles a user gets through
   * group mappings, next to their direct roles.
   */
  groups?: string[] | string;
}

export interface RbacChangeEvent {
  tenantId: string;
  actorId: string;
  action:
    | "role.create"
    | "role.update"
    | "role.delete"
    | "user.roles.set"
    | "group.roles.set"
    | "tenant.seed";
  target: string;
  details?: Record<string, unknown>;
}
