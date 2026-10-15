"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { GroupMapping } from "../types";
import { errorMessage, useRbacAdmin } from "./context";
import { fmt } from "./labels";
import { RoleChips, RolePicker } from "./role-picker";
import { Alert, Button, Empty, Field, Icon, Modal } from "./ui";

type Editing = { mapping: GroupMapping | null } | null;

/** Identity-provider group → roles. Members get the roles on their next request. */
export function GroupMappings() {
  const { api, labels } = useRbacAdmin();
  const [mappings, setMappings] = useState<GroupMapping[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<GroupMapping | null>(null);

  // Bumped to re-fetch after a change.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    api.groups().then(
      (list) => {
        if (!live) return;
        setMappings(list);
        setError(null);
      },
      (err: unknown) => {
        if (live) setError(errorMessage(err));
      },
    );
    return () => {
      live = false;
    };
  }, [api, version]);

  return (
    <section className="rbac-section">
      <div className="rbac-toolbar">
        <p className="rbac-muted">{labels.groupsIntro}</p>
        <Button variant="primary" onClick={() => setEditing({ mapping: null })}>
          <Icon name="plus" size={14} />
          {labels.addMapping}
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="rbac-card">
        {mappings === null && !error ? (
          <div className="rbac-state">
            <span className="rbac-spinner" aria-hidden="true" /> {labels.loading}
          </div>
        ) : !mappings || mappings.length === 0 ? (
          <Empty>{labels.noGroups}</Empty>
        ) : (
          <table className="rbac-table">
            <thead>
              <tr>
                <th>{labels.colGroup}</th>
                <th>{labels.colRoles}</th>
                <th className="rbac-col-actions" aria-label={labels.colActions} />
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.group}>
                  <td>
                    <span className="rbac-group-name">
                      <Icon name="users" size={14} />
                      {m.group}
                    </span>
                  </td>
                  <td>
                    <RoleChips roleIds={m.roleIds} />
                  </td>
                  <td className="rbac-col-actions">
                    <div className="rbac-row-actions">
                      <Button variant="ghost" size="icon" aria-label={labels.edit} onClick={() => setEditing({ mapping: m })}>
                        <Icon name="pencil" size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={labels.remove} onClick={() => setRemoving(m)}>
                        <Icon name="trash" size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <GroupDialog
          key={editing.mapping?.group ?? "new"}
          mapping={editing.mapping}
          onClose={() => setEditing(null)}
          onSaved={() => setVersion((v) => v + 1)}
        />
      )}
      {removing && <RemoveGroupDialog mapping={removing} onClose={() => setRemoving(null)} onSaved={() => setVersion((v) => v + 1)} />}
    </section>
  );
}

function GroupDialog({
  mapping,
  onClose,
  onSaved,
}: {
  mapping: GroupMapping | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api, labels, notify } = useRbacAdmin();
  const [group, setGroup] = useState(mapping?.group ?? "");
  const [roleIds, setRoleIds] = useState<string[]>(mapping?.roleIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (roleIds.length === 0) {
      setError(labels.pickAtLeastOneRole);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setGroupRoles(group.trim(), roleIds);
      notify(fmt(labels.groupSaved, { name: group.trim() }));
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={mapping ? fmt(labels.editMapping, { name: mapping.group }) : labels.addMapping}
      onClose={onClose}
      closeLabel={labels.close}
    >
      <form className="rbac-form" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        {!mapping && (
          <Field label={labels.groupName} hint={labels.groupNameHint} htmlFor="rbac-group-name">
            <input
              id="rbac-group-name"
              className="rbac-input"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              maxLength={255}
              required
            />
          </Field>
        )}
        <RolePicker value={roleIds} onChange={setRoleIds} />
        <div className="rbac-form__actions">
          <Button onClick={onClose} disabled={busy}>
            {labels.cancel}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!group.trim()}>
            {labels.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveGroupDialog({
  mapping,
  onClose,
  onSaved,
}: {
  mapping: GroupMapping;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api, labels, notify } = useRbacAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteGroup(mapping.group);
      notify(fmt(labels.groupRemoved, { name: mapping.group }));
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={labels.remove}
      onClose={onClose}
      closeLabel={labels.close}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {labels.cancel}
          </Button>
          <Button variant="danger" busy={busy} onClick={() => void confirm()}>
            {labels.remove}
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p>{fmt(labels.removeMappingConfirm, { name: mapping.group })}</p>
    </Modal>
  );
}
