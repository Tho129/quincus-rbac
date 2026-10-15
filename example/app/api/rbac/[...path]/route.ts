import { rbac } from "@/lib/rbac";

// The package's admin API, mounted at /api/rbac/*.
export const { GET, POST, PUT, PATCH, DELETE } = rbac.nextHandlers();
