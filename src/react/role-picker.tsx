"use client";

import { useRbacAdmin } from "./context";
import { roleColor } from "./logic";
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
          <span className="rbac-dot" style={{ background: roleColor(role) }} />
          <span className="rbac-picker__name">{role.name}</span>
          {role.isSystem && <Badge tone="warning">{labels.typeSystem}</Badge>}
        </label>
      ))}
    </div>
  );
}

/** The roles behind a list of ids, as coloured chips. */
export function RoleChips({ roleIds }: { roleIds: string[] }) {
  const { roles, labels } = useRbacAdmin();
  const held = roles.filter((role) => roleIds.includes(role.id));
  if (held.length === 0) return <span className="rbac-muted">{labels.noRoles}</span>;
  return (
    <div className="rbac-chips">
      {held.map((role) => (
        <span key={role.id} className="rbac-chip">
          <span className="rbac-dot" style={{ background: roleColor(role) }} />
          {role.name}
        </span>
      ))}
    </div>
  );
}
