"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import type { UserRole } from "@prisma/client";
import { canViewExecutive, canViewCallCenter } from "@/lib/permissions";

interface Props {
  user: { name: string; email: string; role: UserRole; branchId: string | null; executiveAccess: boolean; callCenterAccess: boolean };
  children: React.ReactNode;
}

export function DashboardShell({ user, children }: Props) {
  const qc = useQueryClient();
  useEffect(() => {
    qc.prefetchQuery({ queryKey: ["branches"], queryFn: () => fetch("/api/branches").then(r => r.json()) });
  }, [qc]);
  const canExecutive  = canViewExecutive({ role: user.role, executiveAccess: user.executiveAccess ?? false });
  const canCallCenter = canViewCallCenter({ role: user.role, callCenterAccess: user.callCenterAccess ?? false });
  return (
    <div className="tkl-app flex h-dvh overflow-hidden bg-[#f4f5f7]">
      <Sidebar user={user} />
      <div className="flex flex-1 flex-col min-w-0 lg:pl-60">
        <TopBar canExecutive={canExecutive} canCallCenter={canCallCenter} />
        <main className="flex-1 overflow-y-auto p-4 pb-24 lg:p-6">{children}</main>
      </div>
      <BottomNav user={user} />
    </div>
  );
}
