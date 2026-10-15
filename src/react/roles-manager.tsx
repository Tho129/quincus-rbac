"use client";

import { useState, type FormEvent } from "react";
import type { Role } from "../types";
import { errorMessage, useRbacAdmin } from "./context";
import { fmt } from "./labels";
import { allKeys, roleColor } from "./logic";
import { Alert, Badge, Button, Field, Icon, Modal } from "./ui";

type Editing = { mode: "create" } | { mode: "edit"; role: Role } | null;

/** The roles list: add (optionally copying another role's permissions), edit name/description, delete. */
export function RolesManager() {
  const { roles, catalog, labels } = useRbacAdmin();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const total = allKeys(catalog).length;

  return (
    <section className="rbac-section">
      <div className="rbac-toolbar">
        <p className="rbac-muted">{labels.rolesIntro}</p>
        <Button variant="primary" onClick={() => setEditing({ mode: "create" })}>
          <Icon name="plus" size={14} />
          {labels.addRole}
        </Button>
      </div>

      <div className="rbac-card">
        <table className="rbac-table">
          <thead>
            <tr>
              <th>{labels.colRole}</th>
              <th>{labels.colType}</th>
              <th>{labels.colPermissions}</th>
              <th className="rbac-col-actions" aria-label={labels.colActions} />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>
                  <div className="rbac-role-cell">
                    <span className="rbac-dot" style={{ background: roleColor(role) }} />
                    <div>
                      <div className="rbac-strong">{role.name}</div>
                      {role.description && <div className="rbac-muted rbac-small">{role.description}</div>}
                    </div>
                  </div>
                </td>
                <td>
                  {role.isSystem ? (
                    <Badge tone="warning">
                      <Icon name="lock" size={11} />
                      {labels.typeSystem}
                    </Badge>
                  ) : (
                    <Badge>{labels.typeCustom}</Badge>
                  )}
                </td>
                <td className="rbac-muted">
                  {role.isSystem
                    ? labels.allPermissions
                    : fmt(labels.permissionCount, { count: role.permissions.length, total })}
                </td>
                <td className="rbac-col-actions">
                  {role.isSystem ? (
                    <span className="rbac-muted" title={labels.systemRoleLocked}>
                      <Icon name="lock" size={14} />
                    </span>
                  ) : (
                    <div className="rbac-row-actions">
                      <Button variant="ghost" size="icon" aria-label={labels.editRole} onClick={() => setEditing({ mode: "edit", role })}>
                        <Icon name="pencil" size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={labels.deleteRole} onClick={() => setDeleting(role)}>
                        <Icon name="trash" size={14} />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <RoleDialog key={editing.mode === "edit" ? editing.role.id : "new"} editing={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteRoleDialog role={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}

function RoleDialog({ editing, onClose }: { editing: NonNullable<Editing>; onClose: () => void }) {
  const { api, roles, labels, reloadRoles, notify } = useRbacAdmin();
  const role = editing.mode === "edit" ? editing.role : null;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyable = roles.filter((r) => !r.isSystem);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (role) {
        const saved = await api.updateRole(role.id, { name, description });
        notify(fmt(labels.roleUpdated, { name: saved.name }));
      } else {
        const source = roles.find((r) => r.id === copyFrom);
        const saved = await api.createRole({ name, description, permissions: source ? source.permissions : [] });
        notify(fmt(labels.roleCreated, { name: saved.name }));
      }
      await reloadRoles();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal open title={role ? labels.editRole : labels.addRole} onClose={onClose} closeLabel={labels.close}>
      <form className="rbac-form" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        <Field label={labels.roleName} htmlFor="rbac-role-name">
          <input
            id="rbac-role-name"
            className="rbac-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={labels.roleNamePlaceholder}
            maxLength={100}
            required
          />
        </Field>
        <Field label={labels.roleDescription} htmlFor="rbac-role-description">
          <textarea
            id="rbac-role-description"
            className="rbac-input rbac-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={labels.roleDescriptionPlaceholder}
            maxLength={500}
            rows={2}
          />
        </Field>
        {!role && copyable.length > 0 && (
          <Field label={labels.copyFrom} htmlFor="rbac-role-copy">
            <select id="rbac-role-copy" className="rbac-input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">{labels.copyFromNone}</option>
              {copyable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="rbac-form__actions">
          <Button onClick={onClose} disabled={busy}>
            {labels.cancel}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>
            {role ? labels.save : labels.create}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteRoleDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  const { api, labels, reloadRoles, notify } = useRbacAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteRole(role.id);
      await reloadRoles();
      notify(fmt(labels.roleDeleted, { name: role.name }));
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={labels.deleteRole}
      onClose={onClose}
      closeLabel={labels.close}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {labels.cancel}
          </Button>
          <Button variant="danger" busy={busy} onClick={() => void confirm()}>
            {labels.delete}
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p>{fmt(labels.deleteRoleConfirm, { name: role.name })}</p>
    </Modal>
  );
}
