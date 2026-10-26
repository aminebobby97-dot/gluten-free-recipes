import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { siteConfig } from "@/lib/env";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name}: Gluten-Free Recipes Made Simple`,
    template: `%s | ${siteConfig.name}`,
  },
  description:
    "Easy, flavorful gluten-free recipes for everyday cooking. Discover gluten-free breakfasts, dinners, desserts, baking and more.",
  applicationName: siteConfig.name,
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    locale: siteConfig.locale,
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#faf8f3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-US" className={`${fraunces.variable} ${inter.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
