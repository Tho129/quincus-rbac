"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CatalogGroup } from "../catalog";
import { RBAC_MANAGE } from "../catalog";
import type { Role } from "../types";
import { RbacApiError, createRbacApi, type Me, type RbacApi, type RbacApiOptions } from "./api";
import { DEFAULT_LABELS, type RbacLabels } from "./labels";
import { Alert, Button, Icon } from "./ui";

type Status = "loading" | "ready" | "forbidden" | "signed-out" | "error";

interface Toast {
  id: number;
  message: string;
  tone: "success" | "danger";
}

export interface RbacAdminContextValue {
  api: RbacApi;
  labels: RbacLabels;
  me: Me | null;
  catalog: CatalogGroup[];
  roles: Role[];
  /** Re-reads roles (after a change made elsewhere). */
  reloadRoles: () => Promise<void>;
  notify: (message: string, tone?: Toast["tone"]) => void;
}

const Ctx = createContext<RbacAdminContextValue | null>(null);

export function useRbacAdmin(): RbacAdminContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("rbac: wrap the admin components in <RbacAdminProvider>");
  return value;
}

export interface RbacAdminProviderProps extends RbacApiOptions {
  /** Overrides for any UI text; see `DEFAULT_LABELS`. */
  labels?: Partial<RbacLabels>;
  /** Extra class on the root element, e.g. to scope theme variables. */
  className?: string;
  children: ReactNode;
}

/**
 * Loads the caller, the permission catalog and the roles once, and shares
 * them with the admin components inside. Renders the "no access" state
 * itself when the caller lacks `rbac:manage`.
 */
export function RbacAdminProvider({ apiBase, getHeaders, fetch, labels, className, children }: RbacAdminProviderProps) {
  // The options are read once; changing them later has no effect, like a client's config.
  const [api] = useState(() => createRbacApi({ apiBase, getHeaders, fetch }));
  const text = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);

  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [catalog, setCatalog] = useState<CatalogGroup[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToast = useRef(0);

  // Bumped by "Retry" to load again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const who = await api.me();
      if (!who.permissions.includes(RBAC_MANAGE)) return { who, status: "forbidden" as const };
      const [groups, list] = await Promise.all([api.permissions(), api.roles()]);
      return { who, status: "ready" as const, groups, list };
    })().then(
      (result) => {
        if (!live) return;
        setMe(result.who);
        if (result.status === "ready") {
          setCatalog(result.groups);
          setRoles(result.list);
        }
        setStatus(result.status);
      },
      (err: unknown) => {
        if (!live) return;
        if (err instanceof RbacApiError && err.status === 401) setStatus("signed-out");
        else if (err instanceof RbacApiError && err.status === 403) setStatus("forbidden");
        else setStatus("error");
      },
    );
    return () => {
      live = false;
    };
  }, [api, attempt]);

  const retry = () => {
    setStatus("loading");
    setAttempt((n) => n + 1);
  };

  const reloadRoles = useCallback(async () => {
    setRoles(await api.roles());
  }, [api]);

  const notify = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = ++nextToast.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const value = useMemo<RbacAdminContextValue>(
    () => ({ api, labels: text, me, catalog, roles, reloadRoles, notify }),
    [api, text, me, catalog, roles, reloadRoles, notify],
  );

  return (
    <div className={`rbac-root${className ? ` ${className}` : ""}`}>
      {status === "loading" && (
        <div className="rbac-state">
          <span className="rbac-spinner" aria-hidden="true" /> {text.loading}
        </div>
      )}
      {status === "forbidden" && (
        <div className="rbac-state rbac-state--block">
          <span className="rbac-state__icon">
            <Icon name="lock" size={20} />
          </span>
          <h2 className="rbac-state__title">{text.noAccessTitle}</h2>
          <p className="rbac-muted">{text.noAccessBody}</p>
        </div>
      )}
      {status === "signed-out" && <Alert tone="warning">{text.signedOut}</Alert>}
      {status === "error" && (
        <Alert>
          {text.loadFailed}{" "}
          <Button size="sm" variant="ghost" onClick={retry}>
            {text.retry}
          </Button>
        </Alert>
      )}
      {status === "ready" && <Ctx.Provider value={value}>{children}</Ctx.Provider>}

      <div className="rbac-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`rbac-toast rbac-toast--${t.tone}`}>
            <Icon name={t.tone === "success" ? "check" : "alert"} size={14} />
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The API's message for a failed call, or the generic one. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
