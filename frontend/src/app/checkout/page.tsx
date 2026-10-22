import Link from "next/link";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { getStorefrontConfig } from "@/lib/api/config";
import { parseAccount } from "@/lib/api/decoders";
import { getApiResult } from "@/lib/api/errors";
import { serverGet } from "@/lib/api/server";

export const metadata = { title: "COD Checkout", robots: { index: false, follow: false } };

export default async function CheckoutPage() {
  if (getStorefrontConfig().mode === "mock") return <section className="space-y-3"><h1 className="text-2xl font-semibold">Sample catalog only</h1><p>Checkout is disabled in explicit mock mode. No live order will be placed.</p><Link href="/products" className="inline-flex min-h-11 items-center font-medium text-brand">Continue browsing</Link></section>;
  const account = await getApiResult(() => serverGet("Auth/me", parseAccount));
  return <CheckoutForm initialAccount={account.ok ? account.data : null} />;
}
