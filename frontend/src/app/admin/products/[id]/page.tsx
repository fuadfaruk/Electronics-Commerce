import { notFound } from "next/navigation";
import { AdminAccessNotice } from "@/components/admin/notices";
import { ProductEditor } from "@/components/admin/product-editor";
import { RecordLifecycle } from "@/components/admin/record-lifecycle";
import { adminGet } from "@/components/admin/server";
import { StockAdjustment } from "@/components/admin/stock-adjustment";
import { AdminHeading, AdminPanel, VersionBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { parseCategories, parseProduct } from "@/lib/api/decoders";

export default async function EditAdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const productResult = await adminGet(`Admin/products/${encodeURIComponent(id)}`, parseProduct);
  if (!productResult.ok) {
    if (productResult.problem?.status === 404) notFound();
    return <AdminAccessNotice failure={productResult} returnTo={`/admin/products/${id}`} />;
  }
  const categoriesResult = await adminGet("Admin/categories", parseCategories);
  if (!categoriesResult.ok) return <AdminAccessNotice failure={categoriesResult} returnTo={`/admin/products/${id}`} />;
  const product = productResult.data;
  return (
    <div className="space-y-6" key={`${product.id}:${product.version}`}>
      <AdminHeading title={`Edit ${product.name}`} description="Save metadata against the current version. Archive and stock commands use separate, guarded operations." action={<VersionBadge version={product.version} />} />
      <div className="flex flex-wrap gap-2"><Badge tone={product.isArchived ? "neutral" : "success"}>{product.isArchived ? "Archived product" : "Active product"}</Badge><Badge tone={product.saleEligible ? "success" : "warning"}>{product.saleEligible ? "Eligible for sale" : "Not eligible for sale"}</Badge></div>
      <AdminPanel title="Product details"><ProductEditor product={product} categories={categoriesResult.data} staffId={categoriesResult.account.id} /></AdminPanel>
      <StockAdjustment product={product} staffId={categoriesResult.account.id} />
      <RecordLifecycle kind="products" record={product} staffId={categoriesResult.account.id} />
    </div>
  );
}
