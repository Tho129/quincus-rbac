"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RbacApiError, createRbacApi, type Me, type RbacApiOptions } from "./api";
import { hasPermissions } from "./logic";

export interface PermissionsValue {
  /** The signed-in caller, or null when signed out (or before the first load). */
  me: Me | null;
  permissions: string[];
  loading: boolean;
  /** True when the caller holds `permission` — or, for a list, all of them. */
  can: (permission: string | readonly string[]) => boolean;
  /** True when the caller holds at least one of `permissions`. */
  canAny: (permissions: readonly string[]) => boolean;
  /** Re-reads the caller's permissions, e.g. after an admin change. */
  refresh: () => void;
}

const Ctx = createContext<PermissionsValue | null>(null);

export interface RbacProviderProps extends RbacApiOptions {
  /**
   * The caller as the server already knows it (e.g. `await rbac.identify()`
   * in a server component), so the first render needs no request. `null`
   * means signed out. Leave it out to load from `GET me` on mount.
   */
  initial?: Me | null;
  children: ReactNode;
}

/**
 * Makes the caller's permissions available to `usePermissions()` and `<Can>`.
 * For hiding UI only — the server must still check every action with
 * `rbac.require()`.
 */
export function RbacProvider({ apiBase, getHeaders, fetch, initial, children }: RbacProviderProps) {
  const [api] = useState(() => createRbacApi({ apiBase, getHeaders, fetch }));
  const [hasInitial] = useState(initial !== undefined);
  const [me, setMe] = useState<Me | null>(initial ?? null);
  const [loading, setLoading] = useState(!hasInitial);
  // Bumped by refresh(); 0 is the first load, skipped when `initial` was given.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (version === 0 && hasInitial) return;
    let live = true;
    api.me().then(
      (who) => {
        if (!live) return;
        setMe(who);
        setLoading(false);
      },
      (err: unknown) => {
        if (!live) return;
        // Signed out, or the call failed: show nothing that needs a permission.
        if (!(err instanceof RbacApiError && err.status === 401)) console.error("rbac: could not load permissions", err);
        setMe(null);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [api, version, hasInitial]);

  const refresh = useCallback(() => {
    setLoading(true);
    setVersion((v) => v + 1);
  }, []);

  const value = useMemo<PermissionsValue>(() => {
    const permissions = me?.permissions ?? [];
    return {
      me,
      permissions,
      loading,
      can: (p) => hasPermissions(permissions, p, "all"),
      canAny: (p) => hasPermissions(permissions, p, "any"),
      refresh,
    };
  }, [me, loading, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The caller's permissions. Needs `<RbacProvider>` above. */
export function usePermissions(): PermissionsValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("rbac: usePermissions() needs <RbacProvider> above it");
  return value;
}

export interface CanProps {
  /** Required permission(s); with a list, all of them unless `any` is set. */
  perm: string | readonly string[];
  /** With a list in `perm`: one of them is enough. */
  any?: boolean;
  /** Rendered when the caller lacks the permission (and while loading). Default: nothing. */
  fallback?: ReactNode;
  children: ReactNode;
}

/** Renders its children only for callers holding the permission: `<Can perm="order:edit"><EditButton /></Can>`. */
export function Can({ perm, any, fallback = null, children }: CanProps) {
  const { permissions, loading } = usePermissions();
  if (loading) return <>{fallback}</>;
  return <>{hasPermissions(permissions, perm, any ? "any" : "all") ? children : fallback}</>;
}
