"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const DashboardProviders = dynamic(
  () => import("@/components/providers/DashboardProviders").then((module) => module.DashboardProviders),
  { loading: () => <DashboardBootShell /> },
);

const AdminProviders = dynamic(
  () => import("@/components/providers/AdminProviders").then((module) => module.AdminProviders),
);

function isAdminRoute(pathname: string) {
  return pathname === "/admin"
    || pathname.startsWith("/admin/")
    || pathname === "/dashboard/admin"
    || pathname.startsWith("/dashboard/admin/")
    || pathname === "/m"
    || pathname.startsWith("/m/");
}

function isStandaloneRoute(pathname: string) {
  return pathname === "/preview" || pathname.startsWith("/p/")
    || pathname.startsWith("/c/");
}

function DashboardBootShell() {
  return (
    <div className="app-shell min-h-[100svh] bg-[#07070a]" aria-busy="true" aria-label="Loading dashboard">
      <aside className="sidebar-glass fixed inset-y-0 start-0 hidden w-[248px] border-e p-4 md:block">
        <div className="h-10 w-32 animate-pulse rounded-xl bg-white/[.06]" />
        <div className="mt-10 space-y-3">{Array.from({ length: 7 }, (_, index) => <div key={index} className="h-10 animate-pulse rounded-xl bg-white/[.035]" />)}</div>
      </aside>
      <div className="md:ps-[248px]">
        <header className="h-[68px] border-b border-white/[.06] bg-[#07070a]/80 md:hidden" />
        <main className="mx-auto max-w-[1360px] px-5 py-8 sm:px-8 sm:py-11 xl:px-12">
          <div className="h-8 w-56 animate-pulse rounded-xl bg-white/[.07]" />
          <div className="mt-4 h-4 w-full max-w-md animate-pulse rounded-lg bg-white/[.04]" />
          <div className="mt-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl border border-white/[.05] bg-white/[.025]" />)}</div>
        </main>
      </div>
    </div>
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isAdminRoute(pathname)) return <AdminProviders>{children}</AdminProviders>;
  if (isStandaloneRoute(pathname)) return <>{children}</>;
  return <DashboardProviders>{children}</DashboardProviders>;
}