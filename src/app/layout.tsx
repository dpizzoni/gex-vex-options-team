import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NEXUS Terminal",
  description: "GEX · VEX · Dealer Analysis Engine — Options Flow Intelligence",
  openGraph: {
    title: "NEXUS Terminal",
    description: "GEX · VEX · Dealer Analysis Engine — Options Flow Intelligence",
    url: "https://gex-vex-options-team.vercel.app",
    siteName: "NEXUS Terminal",
    images: [
      {
        url: "/og-preview.png",
        width: 1200,
        height: 630,
        alt: "NEXUS Terminal — GEX VEX Dealer Analysis Engine",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "NEXUS Terminal",
    description: "GEX · VEX · Dealer Analysis Engine — Options Flow Intelligence",
    images: ["/og-preview.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
