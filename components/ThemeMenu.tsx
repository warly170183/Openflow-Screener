"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { Menu, MenuSection } from "@/components/ui/Primitives";
import { isLightTheme, THEME_OPTIONS, type ThemePreference } from "@/lib/theme";
import { useUIStore } from "@/lib/store/uiStore";

function ModeIcon({ pref }: { pref: ThemePreference }) {
  if (pref === "system") return <Icon.Monitor />;
  return isLightTheme(pref) ? <Icon.Sun /> : <Icon.Moon />;
}

export default function ThemeMenu() {
  const [open, setOpen] = useState(false);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const current = THEME_OPTIONS.find((t) => t.value === theme) ?? THEME_OPTIONS[1];

  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      hint={`Theme: ${current.label}`}
      label={
        <>
          <ModeIcon pref={theme} />
          <span className="hide-compact">{current.label}</span>
        </>
      }
    >
      <div className="theme-menu">
        <MenuSection title="Appearance">
          {THEME_OPTIONS.map((option) => {
            const active = option.value === theme;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`theme-option ${active ? "is-active" : ""}`}
                onClick={() => {
                  setTheme(option.value);
                  setOpen(false);
                }}
              >
                <span className="theme-swatches" aria-hidden="true">
                  {option.swatches.map((hex, i) => (
                    <span key={i} className="theme-swatch-dot" style={{ background: hex }} />
                  ))}
                </span>
                <span className="theme-option-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                {active && (
                  <span className="theme-option-check">
                    <Icon.Check />
                  </span>
                )}
              </button>
            );
          })}
        </MenuSection>
      </div>
    </Menu>
  );
}
