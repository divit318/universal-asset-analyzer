"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let _nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);

  // useLayoutEffect is client-only — avoids SSR issues with createPortal
  useLayoutEffect(() => { setMounted(true); }, []); // eslint-disable-line react-hooks/set-state-in-effect

  const toast = useCallback((message: string, type: ToastType = "success") => {
    const id = ++_nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted &&
        createPortal(
          <div
            role="region"
            aria-label="Notifications"
            aria-live="polite"
            className="pointer-events-none fixed bottom-4 right-4 z-[200] flex flex-col-reverse gap-2"
          >
            {toasts.map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={() =>
                setToasts((prev) => prev.filter((x) => x.id !== t.id))
              } />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  const colors =
    toast.type === "success"
      ? "border-positive/30 text-positive"
      : toast.type === "error"
        ? "border-negative/30 text-negative"
        : "border-border text-muted";

  const icon =
    toast.type === "success" ? (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="2 7 6 11 12 3" />
      </svg>
    ) : toast.type === "error" ? (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="3" y1="3" x2="11" y2="11" />
        <line x1="11" y1="3" x2="3" y2="11" />
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="7" cy="7" r="5" />
        <line x1="7" y1="6" x2="7" y2="10" />
        <line x1="7" y1="4" x2="7" y2="4.5" />
      </svg>
    );

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-sm shadow-xl transition-all duration-300 ${colors} ${
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-foreground">{toast.message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-muted transition-colors hover:text-foreground"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="2" y1="2" x2="10" y2="10" />
          <line x1="10" y1="2" x2="2" y2="10" />
        </svg>
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx.toast;
}
