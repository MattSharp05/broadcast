import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "@/styles/globals.css";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "Broadcast",
  description: "Schedule and publish short videos to your social accounts.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={plex.variable}>
      <body>{children}</body>
    </html>
  );
}
