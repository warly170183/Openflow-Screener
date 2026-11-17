"use client";

import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import * as Dialog from "@radix-ui/react-dialog";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { "data-hint"?: string }>(
  function Button({ className = "", ...props }, ref) {
    return <button ref={ref} type="button" className={`ui-button ${className}`} {...props} />;
  }
);

export function Badge({ className = "", ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`ui-badge ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`ui-select ${className}`} {...props} />;
}

// ─── Segmented control ───────────────────────────────────────────
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "sm",
  ariaLabel,
  accent = false,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  size?: "xs" | "sm" | "md";
  ariaLabel?: string;
  accent?: boolean;
}) {
  return (
    <div className={`segmented segmented-${size} ${accent ? "segmented-accent" : ""}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ─── Panel shell ─────────────────────────────────────────────────
export function Panel({
  title,
  subtitle,
  value,
  icon,
  actions,
  footer,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: string;
  subtitle?: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel ${className}`} aria-label={title}>
      <header className="panel-header">
        <div className="panel-heading">
          {icon && <span className="panel-icon">{icon}</span>}
          <div className="panel-titles">
            <h2 className="panel-title">
              {title}
              {value !== undefined && <span className="panel-value">{value}</span>}
            </h2>
            {subtitle && <span className="panel-subtitle">{subtitle}</span>}
          </div>
        </div>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className={`panel-body ${bodyClassName}`}>{children}</div>
      {footer && <footer className="panel-footer">{footer}</footer>}
    </section>
  );
}

// ─── Stat chip ───────────────────────────────────────────────────
export function Stat({
  label,
  value,
  sub,
  tone,
  title,
  className = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "buy" | "sell" | "warn" | "accent" | "muted" | "vwap" | "poc";
  title?: string;
  className?: string;
}) {
  return (
    <div className={`stat ${className}`} title={title}>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</span>
      {sub !== undefined && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

// ─── Popover menu (Radix UI) ─────────────────────────────────────
// Uses @radix-ui/react-popover for collision-aware viewport flipping,
// Escape dismissal, outside-click handling, and accessible ARIA wiring.
export function Menu({
  label,
  children,
  align = "right",
  buttonClassName = "",
  hint,
  open: controlledOpen,
  onOpenChange,
}: {
  label: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  buttonClassName?: string;
  /** Short name shown on hover (for icon-only buttons). */
  hint?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="menu">
        <Popover.Trigger asChild>
          <Button
            className={`${buttonClassName} ${open ? "is-active" : ""}`}
            aria-label={hint}
            data-hint={open ? undefined : hint}
          >
            {label}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className={`menu-popover menu-${align} is-portal`}
            align={align === "right" ? "end" : "start"}
            sideOffset={8}
            collisionPadding={12}
            style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {children}
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover.Root>
  );
}

// ─── Modal dialog shell (Radix UI) ───────────────────────────────
export function DialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  contentClassName = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="bug-dialog-backdrop" />
        <Dialog.Content className={`radix-dialog-content ${contentClassName}`} aria-describedby={description ? undefined : undefined}>
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {description && <Dialog.Description className="sr-only">{description}</Dialog.Description>}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function MenuCheckbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="menu-item" role="menuitemcheckbox" aria-checked={checked}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="menu-check" aria-hidden />
      <span className="menu-item-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="menu-section">
      <div className="menu-section-title">{title}</div>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
