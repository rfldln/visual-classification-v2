import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Visual Classification",
    template: "%s | Visual Classification",
  },
  description: "AI-powered visual classification platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/*
       * GeistSans.variable injects --font-geist-sans as a CSS custom property.
       * GeistMono.variable injects --font-geist-mono.
       * Both are wired to --font-sans / --font-mono in globals.css @theme block.
       * suppressHydrationWarning prevents React mismatch when theme-switchers
       * or browser extensions modify the class attribute at runtime.
       */}
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
