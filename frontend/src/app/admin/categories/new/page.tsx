import { CategoryEditor } from "@/components/admin/category-editor";
import { AdminAccessNotice } from "@/components/admin/notices";
import { requireAdmin } from "@/components/admin/server";
import { AdminHeading, AdminPanel } from "@/components/admin/ui";

export default async function NewAdminCategoryPage() {
  const access = await requireAdmin();
  if (!access.ok) return <AdminAccessNotice failure={access} returnTo="/admin/categories/new" />;
  return <div className="space-y-6"><AdminHeading title="New category" description="Give the category a permanent URL slug and choose its local navigation visual." /><AdminPanel title="Category details"><CategoryEditor staffId={access.account.id} /></AdminPanel></div>;
}
