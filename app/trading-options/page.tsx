import type { Metadata } from "next";
import TradingOptionsView from "@/components/TradingOptionsView";

export const metadata: Metadata = {
  title: "Opciones de Trading",
  description:
    "Análisis técnico en tiempo real con Entrada, Take Profit 1 y 2, Stop Loss basado en ATR y Bandas de Bollinger y gestión de riesgo 2-3%.",
};

export default function TradingOptionsPage() {
  return <TradingOptionsView />;
}
