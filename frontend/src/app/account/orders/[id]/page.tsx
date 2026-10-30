import { notFound } from "next/navigation";
import { AccountAccess } from "@/components/account/account-access";
import { OrderReceipt } from "@/components/orders/order-receipt";
import { ErrorNotice } from "@/components/ui/error-notice";
import { getAccount } from "@/lib/account/server";
import { getStorefrontConfig } from "@/lib/api/config";
import { GUID_PATTERN, parseOrder } from "@/lib/api/decoders";
import { getApiResult } from "@/lib/api/errors";
import { serverGet } from "@/lib/api/server";

export const metadata = { title: "Private Order" };
export default async function AccountOrderPage({ params }: PageProps<"/account/orders/[id]">) {
  if (getStorefrontConfig().guestOnly) notFound();
  const { id } = await params;
  if (!GUID_PATTERN.test(id)) notFound();
  const account = await getAccount();
  if (!account || !account.ok) return <AccountAccess mock={!account} problem={account && !account.ok ? account.problem : undefined} next={`/account/orders/${id}`} />;
  if (!account.data.emailVerified) return <AccountAccess unverified />;
  const order = await getApiResult(() => serverGet(`Account/orders/${id}`, parseOrder));
  return order.ok ? <OrderReceipt order={order.data} /> : <ErrorNotice heading="Private order unavailable" problem={order.problem} />;
}
