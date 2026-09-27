import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Carries the ৳ sign (and the future Bengali UI); Geist has no Bengali glyphs.
const bn = Noto_Sans_Bengali({ variable: "--font-bengali", subsets: ["bengali"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "DIU ERP", template: "%s · DIU ERP" },
  description: "Daffodil International University ERP: admission, student, teacher, accounts.",
};

export const viewport: Viewport = { themeColor: "#f4f6f9", viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable} ${bn.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
