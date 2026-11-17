import type { Metadata } from "next";
import InteractiveChartsView from "@/components/InteractiveChartsView";

export const metadata: Metadata = {
  title: "Gráficos Interactivos",
  description:
    "Representación dinámica en tiempo real con Recharts de todas las métricas numéricas de flujo de órdenes del Terminal.",
};

export default function InteractiveChartsPage() {
  return <InteractiveChartsView />;
}
