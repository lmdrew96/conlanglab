import type { Metadata } from "next";
import { Work_Sans, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ThemeGate } from "@/components/theme-gate";

const bodySans = Work_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inLivingColor = localFont({
  src: "../../fonts/InLivingColorRegular.ttf",
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ConLangLab",
  description: "Generate complete, internally-consistent constructed languages from real linguistic typology.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="vernacular"
      className={`${bodySans.variable} ${geistMono.variable} ${inLivingColor.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg text-text">
        <Providers>
          <ThemeGate />
          {children}
        </Providers>
      </body>
    </html>
  );
}
