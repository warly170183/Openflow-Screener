// Site-wide identity used by metadata, the web manifest and share images.

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  // Vercel exposes the production domain at build time.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE = {
  name: "OrderFlow Screener",
  title: "OrderFlow Screener — Real-time OKX order flow terminal & screener",
  shortName: "OrderFlow Screener",
  description:
    "Self-contained OKX order flow terminal and reference screener: live footprint charts, 30m rolling OBI, VWAP, CVD, order book depth, volume z-score and realized volatility.",
  url: resolveSiteUrl(),
  themeColor: "#08090b",
  accent: "#d7f75b",
  keywords: [
    "order flow",
    "footprint chart",
    "volume profile",
    "cumulative delta",
    "CVD",
    "VWAP",
    "order book",
    "depth of market",
    "time and sales",
    "volume z-score",
    "realized volatility",
    "crypto trading terminal",
    "bitcoin order flow",
    "market microstructure",
    "OKX",
    "OKX perpetual",
    "OKX spot",
  ],
};
