"use client";

import { Can } from "@quincusdev/rbac/react";

/** Client-side hiding with <Can>. The server still checks each action with rbac.require(). */
export function OrderToolbar() {
  return (
    <div className="demo-toolbar">
      <Can perm="order:create" fallback={<span className="demo-muted">No “Create orders” permission</span>}>
        <button type="button">+ New order</button>
      </Can>
      <Can perm={["invoice:view", "report:view"]} any>
        <button type="button">Billing</button>
      </Can>
      <Can perm="rbac:manage">
        <a href="/admin/roles">Manage roles</a>
      </Can>
    </div>
  );
}
