import { RbacAdmin } from "@quincusdev/rbac/react";
import "@quincusdev/rbac/styles.css";

// This is all an app needs for the management screen.
export default function RolesPage() {
  return <RbacAdmin apiBase="/api/rbac" />;
}
