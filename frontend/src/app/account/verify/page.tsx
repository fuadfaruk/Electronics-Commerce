import { notFound } from "next/navigation";
import { EmailAction } from "@/components/account/email-action";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Verify Email" };
export default function VerifyPage() {
  const config = getStorefrontConfig();
  if (config.guestOnly) notFound();
  return <EmailAction action="verify" mode={config.mode} />;
}
