import { notFound } from "next/navigation";
import { OrderTracking } from "@/components/orders/order-tracking";
import { getStorefrontConfig } from "@/lib/api/config";
import { GUID_PATTERN, parseOrder } from "@/lib/api/decoders";
import { getApiResult, safeProblem } from "@/lib/api/errors";
import { serverGet } from "@/lib/api/server";

export const metadata = { title: "Private Order Tracking", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const config = getStorefrontConfig();
  if (config.guestOnly) notFound();
  const { id } = await params;
  if (!GUID_PATTERN.test(id)) notFound();
  const mode = config.mode;
  const order = mode === "mock" ? { ok: false as const, problem: safeProblem(403, "MOCK_READ_ONLY") } : await getApiResult(() => serverGet(`Order/${id}`, parseOrder));
  return <OrderTracking orderId={id.toLowerCase()} initial={order} mode={mode} />;
}
