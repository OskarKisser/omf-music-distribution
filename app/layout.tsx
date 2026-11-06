import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { Geologica } from "next/font/google";
import { AppProviders } from "@/components/AppProviders";
import { AppErrorBoundary } from "@/components/ErrorBoundary";
import { PageTransition } from "@/components/PageTransition";
import { InputFocusScroll } from "@/components/InputFocusScroll";
import { VisualViewportKeyboardBridge } from "@/components/VisualViewportKeyboardBridge";
import { TelegramBootstrap } from "@/components/TelegramBootstrap";
import { TelegramWebAppScript } from "@/components/TelegramWebAppScript";
import { AdaptiveLayout } from "@/components/AdaptiveLayout";
function supabasePreconnectOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const geologica = Geologica({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geologica",
  adjustFontFallback: false,
  display: "swap"
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: "omf mini app",
  description: "Выпуск музыки на стриминги прямо из Telegram",
  /** Экран «Домой»: иконка и запуск без адресной строки. У /admin свой манифест (app/admin/layout.tsx). */
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    /** Opaque bar — без «затемняющих» полос как у black-translucent под вырезом / снизу */
    statusBarStyle: "black"
  }
};

/**
 * theme-color = базовый фон (--omf-bg), чтобы Safari/PWA не накладывал отличающуюся маску на системные полосы.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  /** Android Chrome: layout подстраивается под клавиатуру (в паре с visualViewport на iOS). */
  interactiveWidget: "resizes-content",
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1A1D24" },
    { color: "#1A1D24" }
  ]
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const supabaseOrigin = supabasePreconnectOrigin();

  return (
    <html lang="ru" className="dark">
      <head>
        {/**
         * Было preconnect+TLS к Supabase: в части сетей (РФ, Safari) ранний preconnect
         * к внешнему origin иногда конкурирует с критичным `/_next/*` и тянет тайминги.
         * dns-prefetch — только подсказка резолву, без раннего TCP/TLS.
         */}
        {supabaseOrigin ? <link rel="dns-prefetch" href={supabaseOrigin} /> : null}
      </head>
      <body
        className={`${geologica.variable} font-sans text-foreground antialiased`}
        style={{
          ["--bottom-nav-height" as string]: "4.5rem"
        }}
      >
        <TelegramWebAppScript />
        <TelegramBootstrap />
        <InputFocusScroll />
        <VisualViewportKeyboardBridge />
        <Toaster richColors expand position="top-center" />
        <div className="app-safe-shell">
          <AppProviders>
            <AppErrorBoundary>
              <AdaptiveLayout>
                <PageTransition>{children}</PageTransition>
              </AdaptiveLayout>
            </AppErrorBoundary>
          </AppProviders>
        </div>
      </body>
    </html>
  );
}
