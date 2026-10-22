import { AdminAccessNotice } from "@/components/admin/notices";
import { ProductEditor } from "@/components/admin/product-editor";
import { adminGet } from "@/components/admin/server";
import { AdminHeading, AdminPanel } from "@/components/admin/ui";
import { parseCategories } from "@/lib/api/decoders";

export default async function NewAdminProductPage() {
  const result = await adminGet("Admin/categories", parseCategories);
  if (!result.ok) return <AdminAccessNotice failure={result} returnTo="/admin/products/new" />;
  return <div className="space-y-6"><AdminHeading title="New product" description="Create a zero-stock catalog entry with whole-BDT pricing. Receive stock separately after creation." /><AdminPanel title="Product details"><ProductEditor categories={result.data} staffId={result.account.id} /></AdminPanel></div>;
}
