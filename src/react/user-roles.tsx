"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { UserWithRoles } from "./api";
import { errorMessage, useRbacAdmin } from "./context";
import { fmt } from "./labels";
import { displayName, filterUsers } from "./logic";
import { RoleChips, RolePicker } from "./role-picker";
import { Alert, Button, Empty, Field, Icon, Modal } from "./ui";

type Editing = { user: UserWithRoles; isNew: false } | { user: null; isNew: true } | null;

/**
 * Users and their direct roles. The list comes from the app's `listUsers`
 * plus anyone already holding a role; others can be added by user ID.
 */
export function UserRoles() {
  const { api, labels } = useRbacAdmin();
  const [users, setUsers] = useState<UserWithRoles[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing>(null);

  // Bumped to re-fetch after a save.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    api.users().then(
      (list) => {
        if (!live) return;
        setUsers(list);
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

  const shown = users ? filterUsers(users, query) : [];

  return (
    <section className="rbac-section">
      <div className="rbac-toolbar">
        <p className="rbac-muted">{labels.usersIntro}</p>
        <Button variant="primary" onClick={() => setEditing({ user: null, isNew: true })}>
          <Icon name="plus" size={14} />
          {labels.assignById}
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="rbac-search">
        <Icon name="search" size={14} />
        <input
          className="rbac-search__input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={labels.searchUsers}
          aria-label={labels.searchUsers}
        />
      </div>

      <div className="rbac-card">
        {users === null && !error ? (
          <div className="rbac-state">
            <span className="rbac-spinner" aria-hidden="true" /> {labels.loading}
          </div>
        ) : shown.length === 0 ? (
          <Empty>{query.trim() ? fmt(labels.noUsersMatch, { query: query.trim() }) : labels.noUsers}</Empty>
        ) : (
          <table className="rbac-table">
            <thead>
              <tr>
                <th>{labels.colUser}</th>
                <th>{labels.colRoles}</th>
                <th className="rbac-col-actions" aria-label={labels.colActions} />
              </tr>
            </thead>
            <tbody>
              {shown.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="rbac-strong">{displayName(user)}</div>
                    {(user.email || user.name) && (
                      <div className="rbac-muted rbac-small">{user.email && user.name ? user.email : user.id}</div>
                    )}
                  </td>
                  <td>
                    <RoleChips roleIds={user.roleIds} />
                  </td>
                  <td className="rbac-col-actions">
                    <Button size="sm" onClick={() => setEditing({ user, isNew: false })}>
                      <Icon name="pencil" size={13} />
                      {labels.editRoles}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <UserRolesDialog
          key={editing.user?.id ?? "new"}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => setVersion((v) => v + 1)}
        />
      )}
    </section>
  );
}

function UserRolesDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: NonNullable<Editing>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api, labels, notify } = useRbacAdmin();
  const [userId, setUserId] = useState(editing.user?.id ?? "");
  const [roleIds, setRoleIds] = useState<string[]>(editing.user?.roleIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = editing.user ? displayName(editing.user) : userId.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setUserRoles(userId.trim(), roleIds);
      notify(fmt(labels.userRolesSaved, { name }));
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
      title={editing.isNew ? labels.assignById : fmt(labels.editUserRoles, { name })}
      onClose={onClose}
      closeLabel={labels.close}
    >
      <form className="rbac-form" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        {editing.isNew && (
          <Field label={labels.userId} hint={labels.userIdHint} htmlFor="rbac-user-id">
            <input
              id="rbac-user-id"
              className="rbac-input"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
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
          <Button type="submit" variant="primary" busy={busy} disabled={!userId.trim()}>
            {labels.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
