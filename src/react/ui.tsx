"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/* Small, dependency-free building blocks. All styling lives in styles.css under `rbac-`. */

type IconName = "plus" | "pencil" | "trash" | "lock" | "chevron-down" | "chevron-right" | "check" | "alert" | "x" | "search" | "users";

const PATHS: Record<IconName, string> = {
  plus: "M12 5v14M5 12h14",
  pencil: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
  "chevron-down": "m6 9 6 6 6-6",
  "chevron-right": "m9 6 6 6-6 6",
  check: "M20 6 9 17l-5-5",
  alert: "M12 8v4M12 16h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  x: "M18 6 6 18M6 6l12 12",
  search: "m21 21-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="rbac-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm" | "icon";
  busy?: boolean;
};

export function Button({ variant = "secondary", size = "md", busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={`rbac-btn rbac-btn--${variant} rbac-btn--${size}${className ? ` ${className}` : ""}`}
    >
      {busy && <span className="rbac-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="rbac-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="rbac-switch__thumb" />
    </button>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" | "primary" }) {
  return <span className={`rbac-badge rbac-badge--${tone}`}>{children}</span>;
}

export function RoleChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="rbac-chip">
      <span className="rbac-dot" style={{ background: color }} />
      {name}
    </span>
  );
}

export function Alert({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "warning" | "info" }) {
  return (
    <div className={`rbac-alert rbac-alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={tone === "info" ? "lock" : "alert"} size={14} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rbac-empty">{children}</div>;
}

/** A native <dialog> rendered as a modal; closes on Esc and on the backdrop. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 440,
  closeLabel = "Close",
}: {
  open: boolean;
  title: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal() moves focus to the dialog's first focusable (the close
      // button); put it in the first field instead, when there is one.
      dialog.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="rbac-modal"
      style={{ width }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="rbac-modal__body">
          <div className="rbac-modal__header">
            <h2 className="rbac-modal__title">{title}</h2>
            <Button variant="ghost" size="icon" aria-label={closeLabel} onClick={onClose}>
              <Icon name="x" />
            </Button>
          </div>
          <div className="rbac-modal__content">{children}</div>
          {footer && <div className="rbac-modal__footer">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="rbac-field">
      <label className="rbac-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="rbac-hint">{hint}</p>}
    </div>
  );
}
