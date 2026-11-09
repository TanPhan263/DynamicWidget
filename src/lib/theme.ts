import { useEffect } from "react";

/** Keeps the `dark` class on <html> in step with the system appearance. */
export function useSystemTheme() {
  useEffect(() => {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = () => document.documentElement.classList.toggle("dark", mq?.matches ?? false);
    apply();
    mq?.addEventListener("change", apply);
    return () => mq?.removeEventListener("change", apply);
  }, []);
}
