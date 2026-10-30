import { notFound } from "next/navigation";
import { AuthForm } from "@/components/account/auth-form";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Create Account" };
export default function RegisterPage() {
  const config = getStorefrontConfig();
  if (config.guestOnly) notFound();
  return <AuthForm action="register" mode={config.mode} />;
}
