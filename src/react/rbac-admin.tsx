"use client";

import { useState } from "react";
import { RbacAdminProvider, useRbacAdmin, type RbacAdminProviderProps } from "./context";
import { GroupMappings } from "./group-mappings";
import { PermissionsMatrix } from "./permissions-matrix";
import { RolesManager } from "./roles-manager";
import { UserRoles } from "./user-roles";

export type RbacAdminTab = "roles" | "permissions" | "users" | "groups";

export interface RbacAdminProps extends Omit<RbacAdminProviderProps, "children"> {
  /** Which tabs to show, in order. Default: all four. */
  tabs?: RbacAdminTab[];
  /** The tab open at first. Default: the first of `tabs`. */
  defaultTab?: RbacAdminTab;
  /** Hide the built-in title, e.g. when the app's page already has one. */
  hideHeader?: boolean;
}

/**
 * The complete role/permission management page. Drop it into any route of
 * the app; it talks to the admin API at `apiBase` (default `/api/rbac`).
 */
export function RbacAdmin({ tabs, defaultTab, hideHeader, ...provider }: RbacAdminProps) {
  return (
    <RbacAdminProvider {...provider}>
      <AdminTabs tabs={tabs ?? ["roles", "permissions", "users", "groups"]} defaultTab={defaultTab} hideHeader={hideHeader} />
    </RbacAdminProvider>
  );
}

function AdminTabs({ tabs, defaultTab, hideHeader }: { tabs: RbacAdminTab[]; defaultTab?: RbacAdminTab; hideHeader?: boolean }) {
  const { labels } = useRbacAdmin();
  const [active, setActive] = useState<RbacAdminTab>(defaultTab ?? tabs[0] ?? "roles");
  const title: Record<RbacAdminTab, string> = {
    roles: labels.tabRoles,
    permissions: labels.tabPermissions,
    users: labels.tabUsers,
    groups: labels.tabGroups,
  };

  return (
    <div className="rbac-admin">
      {!hideHeader && (
        <header className="rbac-header">
          <h1 className="rbac-title">{labels.title}</h1>
          <p className="rbac-muted">{labels.subtitle}</p>
        </header>
      )}
      <div className="rbac-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`rbac-tab-${tab}`}
            aria-selected={active === tab}
            aria-controls={`rbac-panel-${tab}`}
            className="rbac-tab"
            onClick={() => setActive(tab)}
          >
            {title[tab]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`rbac-panel-${active}`} aria-labelledby={`rbac-tab-${active}`}>
        {active === "roles" && <RolesManager />}
        {active === "permissions" && <PermissionsMatrix />}
        {active === "users" && <UserRoles />}
        {active === "groups" && <GroupMappings />}
      </div>
    </div>
  );
}
