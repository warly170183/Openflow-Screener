"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ROUTES = [
  { href: "/", label: "Terminal", hint: "Footprint, libro de órdenes y estudios en vivo" },
  { href: "/trading-options", label: "Opciones de Trading", hint: "Setups en vivo: Entrada, TP1/TP2, Stop Loss ATR+Bollinger y Riesgo 2-3%" },
  { href: "/interactive-charts", label: "Gráficos Interactivos", hint: "Métricas numéricas del Terminal en gráficos dinámicos en tiempo real" },
  { href: "/screener", label: "Screener", hint: "Multi-asset OKX perpetual screener & signals" },
  { href: "/architecture", label: "Arquitectura", hint: "Diagrama interactivo, flujo OKX y registro de cambios" },
] as const;

export default function RouteNav() {
  const pathname = usePathname();

  return (
    <nav className="segmented segmented-sm route-nav" aria-label="Primary views">
      {ROUTES.map((route) => {
        const active = route.href === "/" ? pathname === "/" : pathname.startsWith(route.href);
        return (
          <Link
            key={route.href}
            href={route.href}
            className={`route-nav-link ${active ? "is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            title={route.hint}
          >
            {route.label}
          </Link>
        );
      })}
    </nav>
  );
}
