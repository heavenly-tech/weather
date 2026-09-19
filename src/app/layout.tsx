import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app-shell";
import { ProductLoading } from "@/components/product-state";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Heavenly Weather — Chile aviation desk",
  description:
    "METAR, TAF, GRAMET, GAMET, MeteoChile WRF point forecasts, synoptic charts, and a 3D weather field for Chilean aerodromes.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading briefing desk…</div>}>
            <AppShell>
              <Suspense fallback={<ProductLoading rows={4} />}>{children}</Suspense>
            </AppShell>
          </Suspense>
        </TooltipProvider>
      </body>
    </html>
  );
}
