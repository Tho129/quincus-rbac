/** The system permission that gates the role/permission management API and UI. */
export const RBAC_MANAGE = "rbac:manage";

/** An action with display text for the admin UI. A plain string is the label. */
export type ActionSpec = string | { label?: string; description?: string };

/** A resource with display text: `{ label: "Orders", actions: { view: "View orders" } }`. */
export interface ResourceSpec {
  label?: string;
  actions: Readonly<Record<string, ActionSpec>>;
}

/**
 * How an app declares its permissions. Either a list of actions per resource
 * (`{ order: ["view", "edit"] }`), or labelled actions for the admin UI
 * (`{ order: { label: "Orders", actions: { view: "View orders" } } }`).
 */
export type PermissionMap = Readonly<Record<string, readonly string[] | ResourceSpec>>;

type ActionsOf<V> = V extends readonly string[]
  ? V[number]
  : V extends { actions: infer A }
    ? keyof A & string
    : never;

/** The permission keys a map declares (`"order:view" | "order:edit"`), plus `rbac:manage`. */
export type PermissionKey<P extends PermissionMap> =
  | { [R in keyof P & string]: `${R}:${ActionsOf<P[R]>}` }[keyof P & string]
  | typeof RBAC_MANAGE;

export interface CatalogPermission {
  key: string;
  action: string;
  label: string;
  description?: string;
}

export interface CatalogGroup {
  resource: string;
  label: string;
  permissions: CatalogPermission[];
}

export interface Catalog {
  /** Every valid key, `rbac:manage` included, in declaration order. */
  readonly keys: readonly string[];
  /** Keys grouped by resource, with display text, for rendering a permission matrix. */
  readonly groups: readonly CatalogGroup[];
  has(key: string): boolean;
}

const NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const RESERVED_RESOURCE = "rbac";

export function buildCatalog(map: PermissionMap): Catalog {
  const groups: CatalogGroup[] = [];
  const keys: string[] = [];

  for (const [resource, spec] of Object.entries(map)) {
    if (!NAME.test(resource)) throw new Error(`rbac: invalid resource name "${resource}"`);
    if (resource === RESERVED_RESOURCE) {
      throw new Error(`rbac: the "${RESERVED_RESOURCE}" resource is reserved for ${RBAC_MANAGE}`);
    }
    const isList = Array.isArray(spec);
    const actions: [string, ActionSpec][] = isList
      ? (spec as readonly string[]).map((a) => [a, a])
      : Object.entries((spec as ResourceSpec).actions);
    const group: CatalogGroup = {
      resource,
      label: (!isList && (spec as ResourceSpec).label) || humanize(resource),
      permissions: [],
    };
    for (const [action, actionSpec] of actions) {
      if (!NAME.test(action)) throw new Error(`rbac: invalid action name "${resource}:${action}"`);
      const key = `${resource}:${action}`;
      if (keys.includes(key)) throw new Error(`rbac: permission "${key}" is declared twice`);
      keys.push(key);
      const text = typeof actionSpec === "string" ? { label: actionSpec } : actionSpec;
      group.permissions.push({
        key,
        action,
        label: isList || !text.label ? `${humanize(action)} ${group.label.toLowerCase()}` : text.label,
        ...(text.description ? { description: text.description } : {}),
      });
    }
    groups.push(group);
  }

  keys.push(RBAC_MANAGE);
  groups.push({
    resource: RESERVED_RESOURCE,
    label: "Access control",
    permissions: [
      {
        key: RBAC_MANAGE,
        action: "manage",
        label: "Manage roles and permissions",
        description: "Create and edit roles, set their permissions, and assign them to users and groups",
      },
    ],
  });

  const set = new Set(keys);
  return { keys, groups, has: (key) => set.has(key) };
}

/** `"purchase_order"` → `"Purchase order"`. */
function humanize(name: string): string {
  const words = name.replace(/[_.-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
