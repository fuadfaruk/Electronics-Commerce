import { notFound } from "next/navigation";
import { EmailAction } from "@/components/account/email-action";
import { getAccount } from "@/lib/account/server";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Confirm Order Claim" };
export default async function ClaimPage() {
  if (getStorefrontConfig().guestOnly) notFound();
  const account = await getAccount();
  return <EmailAction action="claim" mode={getStorefrontConfig().mode} account={account?.ok ? account.data : null} />;
}
