import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { QueryProvider } from "./query-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farmacias TKL — Supervisión Operativa",
  description: "Sistema interno de gestión operativa",
  manifest: "/manifest.json",
  icons: {
    icon:  "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable:         true,
    title:           "Farmacias TKL",
    statusBarStyle:  "default",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="antialiased">
        <SessionProvider>
          <QueryProvider>{children}</QueryProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
