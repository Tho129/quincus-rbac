"use client";

import { Fragment, useMemo, useState } from "react";
import { errorMessage, useRbacAdmin } from "./context";
import { fmt } from "./labels";
import { dirtyRoleIds, permissionsByRole, toggleAll, togglePermission } from "./logic";
import { Alert, Button, Empty, Icon, Switch } from "./ui";

/**
 * Roles × permissions, grouped by resource, as in Manifold's
 * /settings/permissions: toggle cells, a per-role "All on/off" switch,
 * collapsible groups and a sticky save bar. The system role is not a column —
 * it always holds everything.
 */
export function PermissionsMatrix() {
  const { api, roles, catalog, labels, reloadRoles, notify } = useRbacAdmin();
  const columns = useMemo(() => roles.filter((r) => !r.isSystem), [roles]);
  const systemRoles = roles.filter((r) => r.isSystem);

  const saved = useMemo(() => permissionsByRole(columns), [columns]);
  const [draft, setDraft] = useState<Record<string, string[]>>(saved);
  const [draftBase, setDraftBase] = useState(saved);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Roles were reloaded (saved, or changed in another tab): start again from them.
  if (draftBase !== saved) {
    setDraftBase(saved);
    setDraft(saved);
  }

  const dirty = dirtyRoleIds(draft, saved);

  function toggleGroup(resource: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(resource)) next.delete(resource);
      else next.add(resource);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    for (const id of dirty) {
      try {
        await api.updateRole(id, { permissions: draft[id] ?? [] });
      } catch (err) {
        const role = columns.find((r) => r.id === id);
        failures.push(`${role?.name ?? id}: ${errorMessage(err)}`);
      }
    }
    await reloadRoles().catch(() => undefined);
    setBusy(false);
    if (failures.length) setError(failures.join("\n"));
    else notify(labels.permissionsSaved);
  }

  if (columns.length === 0) {
    return (
      <section className="rbac-section">
        {systemRoles[0] && <Alert tone="info">{fmt(labels.systemBanner, { name: systemRoles[0].name })}</Alert>}
        <Empty>{labels.noCustomRoles}</Empty>
      </section>
    );
  }

  return (
    <section className="rbac-section">
      {error && <Alert>{error}</Alert>}

      <div className="rbac-card">
        <table className="rbac-table rbac-matrix">
          <thead>
            <tr>
              <th className="rbac-matrix__label">{labels.colPermission}</th>
              {columns.map((role) => {
                const anyOn = (draft[role.id] ?? []).length > 0;
                return (
                  <th key={role.id} className="rbac-matrix__role">
                    <div className="rbac-matrix__role-name">{role.name}</div>
                    <button
                      type="button"
                      className={`rbac-pill${anyOn ? " rbac-pill--on" : ""}`}
                      onClick={() => setDraft((d) => ({ ...d, [role.id]: toggleAll(d[role.id] ?? [], catalog) }))}
                    >
                      {anyOn ? labels.allOn : labels.allOff}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {systemRoles[0] && (
              <tr className="rbac-matrix__banner">
                <td colSpan={columns.length + 1}>
                  <Icon name="lock" size={13} />
                  {fmt(labels.systemBanner, { name: systemRoles[0].name })}
                </td>
              </tr>
            )}
            {catalog.map((group) => {
              const isCollapsed = collapsed.has(group.resource);
              return (
                <Fragment key={group.resource}>
                  <tr className="rbac-matrix__group" onClick={() => toggleGroup(group.resource)}>
                    <td colSpan={columns.length + 1}>
                      <button type="button" className="rbac-matrix__group-toggle" aria-expanded={!isCollapsed}>
                        <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={14} />
                        {group.label}
                        <span className="rbac-muted rbac-small">
                          · {fmt(labels.permissionCountShort, { count: group.permissions.length })}
                        </span>
                        {group.description && <span className="rbac-matrix__group-desc">{group.description}</span>}
                      </button>
                    </td>
                  </tr>
                  {!isCollapsed &&
                    group.permissions.map((perm) => (
                      <tr key={perm.key}>
                        <td className="rbac-matrix__label">
                          <div>{perm.label}</div>
                          {perm.description && <div className="rbac-muted rbac-small">{perm.description}</div>}
                        </td>
                        {columns.map((role) => {
                          const granted = (draft[role.id] ?? []).includes(perm.key);
                          return (
                            <td key={role.id} className="rbac-matrix__cell">
                              <Switch
                                checked={granted}
                                label={`${role.name}: ${perm.label}`}
                                onChange={(on) =>
                                  setDraft((d) => ({
                                    ...d,
                                    [role.id]: togglePermission(d[role.id] ?? [], perm.key, on, catalog),
                                  }))
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {dirty.length > 0 && (
        <div className="rbac-savebar" role="region" aria-label={labels.unsavedChanges}>
          <span className="rbac-savebar__text">
            <span className="rbac-savebar__pulse" />
            {labels.unsavedChanges}
          </span>
          <div className="rbac-savebar__actions">
            <Button onClick={() => setDraft(saved)} disabled={busy}>
              {labels.discard}
            </Button>
            <Button variant="primary" busy={busy} onClick={() => void save()}>
              {busy ? labels.saving : labels.saveChanges}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
