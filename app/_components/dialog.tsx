"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className = "",
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = title ? "dialog-title" : undefined;
  const descId = description ? "dialog-desc" : undefined;

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Focus trap + initial focus
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Store and restore focus
    const previously = document.activeElement as HTMLElement | null;
    first?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || focusable.length === 0) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previously?.focus();
    };
  }, [open]);

  // Prevent body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        style={{ animation: "dialog-enter 150ms ease-out" }}
        className={`relative w-full max-w-sm rounded-xl border border-border bg-surface shadow-2xl ${className}`}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="2" y1="2" x2="12" y2="12" />
                <line x1="12" y1="2" x2="2" y2="12" />
              </svg>
            </button>
          </div>
        )}
        {description && (
          <p id={descId} className="sr-only">
            {description}
          </p>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}

/** Side-anchored panel sharing Dialog's focus trap, Escape-to-close, and scroll lock. */
export function Drawer({ open, onClose, label, children, className = "" }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const previously = document.activeElement as HTMLElement | null;
    first?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || focusable.length === 0) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previously?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        style={{ animation: "dialog-enter 200ms ease-out" }}
        className={`relative flex h-full w-full flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={message}>
      <p className="mb-6 text-sm text-muted">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            danger
              ? "bg-negative/15 text-negative hover:bg-negative/25 border border-negative/30"
              : "bg-accent/15 text-accent hover:bg-accent/25 border border-accent/30"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
