import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sold-Outs Triage | UK Local",
  description: "Morning sold-out triage, net £ EV, and merchant marking for UK Local reps.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="fixed top-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-b border-zinc-200 border-t-[3px] border-t-[#53a318]">
          <div className="shell-99vw px-3 sm:px-6 h-16 flex items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-900 min-w-0">
              <CheckCircle2 className="w-5 h-5 text-[#53a318] shrink-0" />
              <span className="truncate">UK Local Sold-Outs</span>
            </Link>
            <span className="text-caption shrink-0">Pre-Freeze Triage</span>
          </div>
        </header>

        <main className="shell-99vw flex-1 pt-20 pb-10 px-2 sm:px-6">
          {children}
        </main>

        <footer className="shell-99vw border-t border-zinc-200 bg-white py-5 px-3 sm:px-6 mt-auto">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-900">
              <CheckCircle2 className="w-4 h-4 text-[#53a318] shrink-0" />
              <span>UK Local Sold-Outs</span>
            </Link>
            <span className="text-caption">
              Deterministic EV in code · Substring-verified quotes · Read-only routing status
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
