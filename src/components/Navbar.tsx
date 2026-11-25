"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="top-0 z-30 w-full border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="container mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-zinc-100 transition hover:text-white"
        >
          EnvShare
        </Link>

        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="/"
            className={`transition ${
              pathname === "/" || pathname === "/share"
                ? "font-medium text-zinc-100"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            Share
          </Link>
          <Link
            href="/unseal"
            className={`transition ${
              pathname?.startsWith("/unseal") || pathname?.startsWith("/s/")
                ? "font-medium text-zinc-100"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            Unseal
          </Link>
        </nav>
      </div>
    </header>
  );
}
