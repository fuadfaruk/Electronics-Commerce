import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { CartProvider } from "@/lib/cart/store";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout reach under the notch and home indicator.
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`}>
      <body className="font-sans antialiased">
        <CartProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-3 focus:text-sm focus:font-medium focus:shadow-lg"
          >
            Skip to content
          </a>

          {/*
            Bottom padding clears the fixed tab bar on phones so the footer is
            never hidden behind it.
          */}
          <div className="flex min-h-dvh flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            <SiteHeader />
            <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">
              {children}
            </main>
            <SiteFooter />
          </div>

          <BottomNav />
          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  );
}
