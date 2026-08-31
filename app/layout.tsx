import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TerraCDM // Situation Room",
  description: "Incoming signals, search, and operational actions.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
