"use client";
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { UserRole } from "@prisma/client";

interface Props {
  user: { name: string; email: string; role: UserRole; branchId: string | null };
  children: React.ReactNode;
}

export function DashboardShell({ user, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f5f7]">
      <Sidebar user={user} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col min-w-0 lg:pl-60">
        <TopBar onMenuClick={() => setSidebarOpen(true)} userRole={user.role} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
