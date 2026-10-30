import { notFound } from "next/navigation";
import { AuthForm } from "@/components/account/auth-form";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Resend Verification" };
export default function ResendPage() {
  const config = getStorefrontConfig();
  if (config.guestOnly) notFound();
  return <AuthForm action="resend" mode={config.mode} />;
}
