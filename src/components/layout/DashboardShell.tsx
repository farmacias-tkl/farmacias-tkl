"use client";
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { UserRole } from "@prisma/client";
import { canViewExecutive } from "@/lib/permissions";

interface Props {
  user: { name: string; email: string; role: UserRole; branchId: string | null; executiveAccess: boolean };
  children: React.ReactNode;
}

export function DashboardShell({ user, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const canExecutive = canViewExecutive({ role: user.role, executiveAccess: user.executiveAccess ?? false });
  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f5f7]">
      <Sidebar user={user} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col min-w-0 lg:pl-60">
        <TopBar onMenuClick={() => setSidebarOpen(true)} canExecutive={canExecutive} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
