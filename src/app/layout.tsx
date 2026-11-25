import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "EnvShare",
  description: "End-to-end encrypted sharing",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gradient-to-tr from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-100 antialiased">
        <Navbar />
        <main className="container mx-auto max-w-3xl px-4 py-8 sm:py-12">
          {children}
        </main>
      </body>
    </html>
  );
}
