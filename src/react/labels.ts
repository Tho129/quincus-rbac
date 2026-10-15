/**
 * Every user-visible string of the admin UI. Pass `labels` to translate or
 * reword; anything left out falls back to this English default. `{name}`-style
 * placeholders are filled in by the UI.
 */
export const DEFAULT_LABELS = {
  title: "Roles & permissions",
  subtitle: "Control what people in your organization can see and do.",

  tabRoles: "Roles",
  tabPermissions: "Permissions",
  tabUsers: "Users",
  tabGroups: "IdP groups",

  cancel: "Cancel",
  close: "Close",
  save: "Save",
  saving: "Saving…",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  remove: "Remove",
  retry: "Retry",
  loading: "Loading…",

  noAccessTitle: "You don't have access",
  noAccessBody: "Managing roles requires the “Manage roles and permissions” permission. Ask an administrator.",
  signedOut: "You are signed out.",
  loadFailed: "Couldn't load roles and permissions.",

  rolesIntro: "Roles bundle permissions. Assign them to users, or to identity-provider groups.",
  addRole: "Add role",
  editRole: "Edit role",
  deleteRole: "Delete role",
  deleteRoleConfirm: "Delete the role “{name}”? Everyone holding it loses its permissions. This cannot be undone.",
  roleName: "Role name",
  roleNamePlaceholder: "e.g. Dispatcher",
  roleDescription: "Description",
  roleDescriptionPlaceholder: "What is this role for?",
  copyFrom: "Copy permissions from",
  copyFromNone: "None — start empty",
  colRole: "Role",
  colType: "Type",
  colPermissions: "Permissions",
  colActions: "Actions",
  typeSystem: "System",
  typeCustom: "Custom",
  allPermissions: "All",
  permissionCount: "{count} of {total}",
  roleCreated: "Role “{name}” created.",
  roleUpdated: "Role “{name}” saved.",
  roleDeleted: "Role “{name}” deleted.",
  systemRoleLocked: "The system role always has every permission and cannot be changed.",

  colPermission: "Permission",
  allOn: "All on",
  allOff: "All off",
  systemBanner: "{name} always has every permission — this cannot be changed.",
  noCustomRoles: "No custom roles yet. Add one in the Roles tab to set its permissions here.",
  permissionCountShort: "{count} permissions",
  unsavedChanges: "You have unsaved changes",
  discard: "Discard",
  saveChanges: "Save changes",
  permissionsSaved: "Permissions saved.",

  usersIntro: "Give people roles directly. People can also get roles through their identity-provider groups.",
  searchUsers: "Search users",
  assignById: "Assign by user ID",
  userId: "User ID",
  userIdHint: "The user's identifier from your identity provider (e.g. the token's sub).",
  colUser: "User",
  colRoles: "Roles",
  noRoles: "No roles",
  editUserRoles: "Roles for {name}",
  editRoles: "Edit roles",
  noUsers: "No users yet. Use “Assign by user ID” to give someone a role.",
  noUsersMatch: "No users match “{query}”.",
  userRolesSaved: "Roles of {name} saved.",

  groupsIntro: "People signed in through your identity provider get these roles from their groups automatically, on their next request.",
  addMapping: "Map a group",
  editMapping: "Roles for group {name}",
  groupName: "Group name",
  groupNameHint: "Exactly as your identity provider sends it (case-sensitive).",
  colGroup: "Group",
  noGroups: "No groups mapped yet.",
  removeMappingConfirm: "Stop giving roles to members of “{name}”?",
  groupSaved: "Group “{name}” saved.",
  groupRemoved: "Group “{name}” removed.",
  pickAtLeastOneRole: "Pick at least one role.",
};

export type RbacLabels = typeof DEFAULT_LABELS;

/** Fills `{placeholders}` in a label. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
