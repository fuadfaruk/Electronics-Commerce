import { notFound } from "next/navigation";
import { AuthForm } from "@/components/account/auth-form";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Forgot Password" };
export default function ForgotPage() {
  const config = getStorefrontConfig();
  if (config.guestOnly) notFound();
  return <AuthForm action="forgot" mode={config.mode} />;
}
