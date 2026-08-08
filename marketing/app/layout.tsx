import type { Metadata } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "CricketConnect — Gully to Gallery.",
  description:
    "Connect with players. Build teams. Join tournaments. Make your cricket count. Ball-by-ball live scoring, real tournaments, and a community built for the grassroots game.",
  metadataBase: new URL("https://cricket-pied-ten.vercel.app"),
  openGraph: {
    title: "CricketConnect — Gully to Gallery.",
    description:
      "Connect with players. Build teams. Join tournaments. Make your cricket count.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable} h-full`}>
      <body className="h-full bg-bg text-ink antialiased selection:bg-accent selection:text-[#041018]">
        {children}
      </body>
    </html>
  );
}
