import { notFound } from "next/navigation";
import { EmailAction } from "@/components/account/email-action";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Reset Password" };
export default function ResetPage() {
  const config = getStorefrontConfig();
  if (config.guestOnly) notFound();
  return <EmailAction action="reset" mode={config.mode} />;
}
