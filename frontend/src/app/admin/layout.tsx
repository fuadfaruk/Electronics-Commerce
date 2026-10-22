import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminNavigation } from "@/components/admin/navigation";

export const metadata: Metadata = {
  title: "Staff workspace",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-6">
      <AdminNavigation />
      {children}
    </div>
  );
}
