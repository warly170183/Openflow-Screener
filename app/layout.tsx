import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { SITE } from "@/lib/site";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE.title,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.shortName,
  keywords: SITE.keywords,
  authors: [{ name: SITE.name }],
  creator: SITE.name,
  publisher: SITE.name,
  category: "finance",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    locale: "en_US",
    // Images come from app/opengraph-image.tsx.
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.title,
    description: SITE.description,
    // Images come from app/twitter-image.tsx.
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  appleWebApp: {
    capable: true,
    title: SITE.shortName,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false, email: false, address: false },
  other: {
    "msapplication-TileColor": SITE.themeColor,
  },
};

export const viewport: Viewport = {
  themeColor: SITE.themeColor,
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

import ThemeProvider from "@/components/ThemeProvider";
import AppProviders from "@/components/AppProviders";
import { THEMES } from "@/lib/theme";

const PREPAINT_THEMES = JSON.stringify(THEMES);

const THEME_INIT_SCRIPT = `(() => {
  try {
    const raw = localStorage.getItem("oft-ui-preferences");
    const parsed = raw ? JSON.parse(raw) : null;
    const pref = parsed && parsed.state && parsed.state.theme ? parsed.state.theme : "dark";
    const resolved = pref === "system"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : pref;
    const map = ${PREPAINT_THEMES};
    const tokens = map[resolved] || map.dark;
    const root = document.documentElement;
    for (const k in tokens) root.style.setProperty(k, tokens[k]);
    root.setAttribute("data-theme", resolved in map ? resolved : "dark");
    root.setAttribute("data-theme-pref", pref);
    root.style.colorScheme = (resolved === "light" || resolved === "light-dull" || resolved === "sepia") ? "light" : "dark";
  } catch {}
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
          crossOrigin="anonymous"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- single-layout app, fonts apply site-wide */}
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider />
        <AppProviders>{children}</AppProviders>
        {/* Google Analytics 4 — uses next/script to avoid SSR script warning */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-RECLTGYHCC"
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-RECLTGYHCC');
          `}
        </Script>
      </body>
    </html>
  );
}
