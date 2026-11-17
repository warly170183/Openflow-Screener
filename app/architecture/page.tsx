import type { Metadata } from "next";
import ArchitectureView from "@/components/ArchitectureView";

export const metadata: Metadata = {
  title: "Arquitectura",
  description:
    "Diagrama interactivo y explicación técnica del pipeline Order Flow, Relay SSE y Screener sobre OKX.",
};

export default function ArchitecturePage() {
  return <ArchitectureView />;
}
