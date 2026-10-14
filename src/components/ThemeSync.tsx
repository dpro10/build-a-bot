"use client";
import * as React from "react";

/**
 * Keeps <html data-theme> right after hydration: re-applies the saved choice if React
 * ever re-renders the root (which drops attributes set by the pre-paint script), and
 * follows the system setting live when the owner hasn't picked one.
 */
export function ThemeSync() {
  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem("bab-theme");
      } catch {
        /* private mode */
      }
      const theme = saved === "light" || saved === "dark" ? saved : media.matches ? "dark" : "light";
      if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return null;
}
