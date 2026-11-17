"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AssetLogo } from "@/components/AssetLogo";
import { Icon } from "@/components/ui/Icons";
import { matchesSearch } from "@/components/ui/Picker";
import { Button, DialogShell } from "@/components/ui/Primitives";
import { ALL_ASSETS, venuesWithData } from "@/lib/config/instruments";
import { FOREX_GROUPS, FOREX_SYMBOLS } from "@/lib/config/venues";
import { THEME_OPTIONS, type ThemePreference } from "@/lib/theme";
import { useUIStore } from "@/lib/store/uiStore";

interface CommandItem {
  id: string;
  group: string;
  label: string;
  sub?: string;
  keywords?: string;
  icon?: React.ReactNode;
  trailing?: string;
  run: () => void;
}

export default function CommandPalette({
  onSelectInstrument,
}: {
  /** Optional in-terminal callback so switching symbols does not trigger a full route reload. */
  onSelectInstrument?: (symbol: string, marketType: "perpetual" | "spot" | "forex") => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const setTheme = useUIStore((s) => s.setTheme);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setQuery("");
      setActiveIndex(0);
    }
    setOpen(next);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => {
          const next = !prev;
          if (next) {
            setQuery("");
            setActiveIndex(0);
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const openInstrument = (symbol: string, market: "perpetual" | "spot" | "forex") => {
      if (pathname === "/" && onSelectInstrument) {
        onSelectInstrument(symbol, market);
      } else {
        router.push(`/?symbol=${encodeURIComponent(symbol)}&market=${market}`);
      }
      setOpen(false);
    };

    const navItems: CommandItem[] = [
      {
        id: "nav-terminal",
        group: "Navigate",
        label: "Order Flow Terminal",
        sub: "Footprint, CVD, order book & microstructure studies",
        keywords: "terminal chart footprint home",
        icon: <Icon.Footprint />,
        trailing: "/",
        run: () => {
          router.push("/");
          setOpen(false);
        },
      },
      {
        id: "nav-trading-options",
        group: "Navigate",
        label: "Opciones de Trading",
        sub: "Entrada, TP1/TP2, Stop Loss ATR + Bollinger y riesgo 2–3%",
        keywords: "trading options opciones atr bollinger stop loss take profit riesgo",
        icon: <Icon.Sliders />,
        trailing: "/trading-options",
        run: () => {
          router.push("/trading-options");
          setOpen(false);
        },
      },
      {
        id: "nav-interactive-charts",
        group: "Navigate",
        label: "Gráficos Interactivos",
        sub: "Métricas numéricas del Terminal en gráficos dinámicos en tiempo real",
        keywords: "graficos interactivos charts recharts cvd obi vap hvn",
        icon: <Icon.Delta />,
        trailing: "/interactive-charts",
        run: () => {
          router.push("/interactive-charts");
          setOpen(false);
        },
      },
      {
        id: "nav-screener",
        group: "Navigate",
        label: "Multi-Asset Screener",
        sub: "Live OKX perpetual ranking, signals & forward test",
        keywords: "screener signals scan okx",
        icon: <Icon.Pulse />,
        trailing: "/screener",
        run: () => {
          router.push("/screener");
          setOpen(false);
        },
      },
      {
        id: "nav-architecture",
        group: "Navigate",
        label: "Arquitectura del sistema",
        sub: "Gráficos interactivos, flujo OKX y registro de cambios",
        keywords: "architecture arquitectura diagram flujo okx relay cambios",
        icon: <Icon.Network />,
        trailing: "/architecture",
        run: () => {
          router.push("/architecture");
          setOpen(false);
        },
      },
    ];

    const perpAssets: CommandItem[] = ALL_ASSETS.filter(
      (a) => venuesWithData(`${a.base}USDT`, "perpetual").length > 0
    ).map((a) => {
      const sym = `${a.base}USDT`;
      return {
        id: `perp-${sym}`,
        group: "Perpetuals",
        label: `${a.base}/USDT Perp`,
        sub: a.name,
        keywords: `${a.base} ${a.name} perp perpetual futures ${sym}`,
        icon: <AssetLogo symbol={sym} size={20} />,
        trailing: `${venuesWithData(sym, "perpetual").length}v`,
        run: () => openInstrument(sym, "perpetual"),
      };
    });

    const fxAssets: CommandItem[] = FOREX_SYMBOLS.map((pair) => ({
      id: `fx-${pair}`,
      group: "Forex",
      label: pair,
      sub: `FX ${FOREX_GROUPS[pair] === "Majors" ? "Major" : "Cross"}`,
      keywords: `${pair} fx forex`,
      icon: <AssetLogo symbol={pair} size={20} />,
      trailing: "FX",
      run: () => openInstrument(pair, "forex"),
    }));

    const themeItems: CommandItem[] = THEME_OPTIONS.map((t) => ({
      id: `theme-${t.value}`,
      group: "Themes",
      label: `Theme: ${t.label}`,
      sub: t.description,
      keywords: `theme appearance ${t.label} ${t.mode}`,
      icon: <Icon.Palette />,
      trailing: t.mode,
      run: () => {
        setTheme(t.value as ThemePreference);
        setOpen(false);
      },
    }));

    return [...navItems, ...perpAssets, ...fxAssets, ...themeItems];
  }, [onSelectInstrument, pathname, router, setTheme]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 14);
    return items.filter((item) => matchesSearch(query, `${item.label} ${item.sub ?? ""} ${item.keywords ?? ""}`)).slice(0, 24);
  }, [items, query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(Math.max(0, filtered.length - 1), i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && filtered[activeIndex]) {
      e.preventDefault();
      filtered[activeIndex].run();
    }
  };

  return (
    <>
      <Button
        className="cmd-trigger"
        onClick={() => handleOpenChange(true)}
        aria-label="Open command palette"
        data-hint="Quick jump (⌘K)"
      >
        <Icon.Search />
        <span className="hide-compact">Quick jump</span>
        <kbd className="cmd-kbd hide-compact">⌘K</kbd>
      </Button>

      <DialogShell
        open={open}
        onOpenChange={handleOpenChange}
        title="Command Palette"
        description="Jump to any instrument, view, or theme"
        contentClassName="cmd-dialog"
      >
        <div className="cmd-shell" onKeyDown={onKeyDown}>
          <div className="cmd-input-row">
            <Icon.Search />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              placeholder="Jump to symbol (BTC, XAU, EUR/USD), view, or theme…"
              aria-label="Command search"
            />
            <kbd>ESC</kbd>
          </div>
          <div className="cmd-list" ref={listRef} role="listbox">
            {filtered.length === 0 && <div className="picker-empty">No matching commands or symbols</div>}
            {filtered.map((item, idx) => {
              const showGroup = idx === 0 || filtered[idx - 1].group !== item.group;
              return (
                <div key={item.id}>
                  {showGroup && <div className="picker-group">{item.group}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={idx === activeIndex}
                    data-cmd-index={idx}
                    className={`picker-option ${idx === activeIndex ? "is-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={item.run}
                  >
                    {item.icon}
                    <span className="picker-option-text">
                      <span>{item.label}</span>
                      {item.sub && <small>{item.sub}</small>}
                    </span>
                    {item.trailing && <span className="picker-trailing">{item.trailing}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </DialogShell>
    </>
  );
}
