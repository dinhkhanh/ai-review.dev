import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "../../components/sign-out-button";
import { requireUser } from "../../lib/auth";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "Dashboard", adminOnly: false },
  { href: "/intake", label: "New review", adminOnly: false },
  { href: "/jobs", label: "Jobs", adminOnly: false },
  { href: "/articles", label: "Articles", adminOnly: false },
  { href: "/products", label: "Products", adminOnly: false },
  { href: "/affiliate", label: "Affiliate", adminOnly: false },
  { href: "/reports", label: "Visitor reports", adminOnly: false },
  { href: "/settings", label: "Settings", adminOnly: false },
  { href: "/audit", label: "Audit log", adminOnly: true },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-56 shrink-0 border-r border-border bg-bg p-4 md:block">
        <p className="px-2 text-sm font-semibold">AI Review CMS</p>
        <nav className="mt-6 space-y-1" aria-label="Main">
          {NAV.filter((n) => isAdmin || !n.adminOnly).map((n) => (
            <Link key={n.href} href={n.href} className="block rounded-md px-2 py-1.5 text-sm hover:bg-surface">
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-bg px-4">
          <span className="text-sm text-muted md:hidden">AI Review CMS</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted">
              {user.email} · {user.role}
            </span>
            <SignOutButton />
          </div>
        </header>
        <nav
          className="flex gap-3 overflow-x-auto border-b border-border bg-bg px-4 py-2 text-sm md:hidden"
          aria-label="Main"
        >
          {NAV.filter((n) => isAdmin || !n.adminOnly).map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap hover:underline">
              {n.label}
            </Link>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
