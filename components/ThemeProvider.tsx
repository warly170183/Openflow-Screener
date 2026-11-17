"use client";

import { useEffect, useLayoutEffect } from "react";
import { applyTheme } from "@/lib/theme";
import { useUIStore } from "@/lib/store/uiStore";

/**
 * Global theme & UI preference synchronizer mounted at the app root so both
 * `/` (Terminal) and `/screener` share the exact same persisted theme and
 * live `prefers-color-scheme` updates.
 */
export default function ThemeProvider() {
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    void useUIStore.persist.rehydrate();
  }, []);

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return null;
}
