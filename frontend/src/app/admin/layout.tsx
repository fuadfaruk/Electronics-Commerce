import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/account/logout-button";
import { AdminNavigation } from "@/components/admin/navigation";
import { requireAdmin } from "@/components/admin/server";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata: Metadata = {
  title: "Staff workspace",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await requireAdmin();
  return (
    <div className="min-w-0 space-y-6">
      <AdminNavigation />
      {access.ok ? <LogoutButton mode={getStorefrontConfig().mode} accountId={access.account.id} /> : null}
      {children}
    </div>
  );
}
