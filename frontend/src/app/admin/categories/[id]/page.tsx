import { notFound } from "next/navigation";
import { CategoryEditor } from "@/components/admin/category-editor";
import { AdminAccessNotice } from "@/components/admin/notices";
import { RecordLifecycle } from "@/components/admin/record-lifecycle";
import { adminGet } from "@/components/admin/server";
import { AdminHeading, AdminPanel, VersionBadge } from "@/components/admin/ui";
import { parseCategories } from "@/lib/api/decoders";

export default async function EditAdminCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await adminGet("Admin/categories", parseCategories);
  if (!result.ok) return <AdminAccessNotice failure={result} returnTo={`/admin/categories/${id}`} />;
  const category = result.data.find((item) => item.id === id);
  if (!category) notFound();
  return (
    <div className="space-y-6" key={`${category.id}:${category.version}`}>
      <AdminHeading title={`Edit ${category.name}`} description={`${category.productCount} product references. Metadata saves use the version shown and never change the permanent slug.`} action={<VersionBadge version={category.version} />} />
      <AdminPanel title="Category details"><CategoryEditor category={category} staffId={result.account.id} /></AdminPanel>
      <RecordLifecycle kind="categories" record={category} staffId={result.account.id} />
    </div>
  );
}
