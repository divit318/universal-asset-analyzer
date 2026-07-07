"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "uaa-theme";

/* Inline script string rendered in <head> to set data-theme before first
   paint — avoids a light/dark flash. Dark is the default; a stored preference
   wins. Kept as a string so it can be injected via dangerouslySetInnerHTML. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t='dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

function getSnapshot(): Theme {
  if (typeof document === "undefined") return "dark";
  return (document.documentElement.getAttribute("data-theme") as Theme) || "dark";
}

function getServerSnapshot(): Theme {
  return "dark";
}

function subscribe(callback: () => void) {
  window.addEventListener("themechange", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("themechange", callback);
    window.removeEventListener("storage", callback);
  };
}

/** Read + control the active theme. SSR-safe (defaults to dark on the server). */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable (private mode) — theme still applies for the session */
    }
    window.dispatchEvent(new Event("themechange"));
  }, []);

  const toggle = useCallback(() => {
    setTheme(getSnapshot() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggle };
}

/** Header control — animated sun/moon toggle between light and dark. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-2 hover:text-foreground ${className}`}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
    >
      <span key={isDark ? "moon" : "sun"} className="animate-icon-swap inline-flex">
        {isDark ? <Moon className="h-[18px] w-[18px]" strokeWidth={1.75} /> : <Sun className="h-[18px] w-[18px]" strokeWidth={1.75} />}
      </span>
    </button>
  );
}
