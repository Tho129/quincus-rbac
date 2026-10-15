"use client";

import { useRbacAdmin } from "./context";
import { fmt } from "./labels";
import type { InheritedRole } from "./logic";
import { Badge } from "./ui";

/** A checkbox list of the tenant's roles. */
export function RolePicker({ value, onChange }: { value: string[]; onChange: (roleIds: string[]) => void }) {
  const { roles, labels } = useRbacAdmin();
  const selected = new Set(value);

  return (
    <div className="rbac-picker" role="group" aria-label={labels.colRoles}>
      {roles.map((role) => (
        <label key={role.id} className="rbac-picker__item">
          <input
            type="checkbox"
            checked={selected.has(role.id)}
            onChange={(e) => {
              const next = new Set(selected);
              if (e.target.checked) next.add(role.id);
              else next.delete(role.id);
              onChange(roles.filter((r) => next.has(r.id)).map((r) => r.id));
            }}
          />
          <span className="rbac-picker__name">{role.name}</span>
          {role.isSystem && <Badge tone="warning">{labels.typeSystem}</Badge>}
        </label>
      ))}
    </div>
  );
}

/**
 * A user's roles as chips: direct roles first, then the ones they get through
 * IdP groups (dashed, "via <group>").
 */
export function RoleChips({ roleIds, inherited = [] }: { roleIds: string[]; inherited?: InheritedRole[] }) {
  const { roles, labels } = useRbacAdmin();
  const name = (id: string) => roles.find((r) => r.id === id)?.name;
  const direct = roles.filter((role) => roleIds.includes(role.id));
  const viaGroups = inherited.filter((r) => name(r.roleId));
  if (direct.length === 0 && viaGroups.length === 0) return <span className="rbac-muted">{labels.noRoles}</span>;
  return (
    <div className="rbac-chips">
      {direct.map((role) => (
        <span key={role.id} className="rbac-chip">
          {role.name}
        </span>
      ))}
      {viaGroups.map((r) => {
        const via = fmt(labels.viaGroup, { group: r.groups.join(", ") });
        return (
          <span key={r.roleId} className="rbac-chip rbac-chip--inherited" title={via}>
            {name(r.roleId)}
            <span className="rbac-chip__via">{via}</span>
          </span>
        );
      })}
    </div>
  );
}
