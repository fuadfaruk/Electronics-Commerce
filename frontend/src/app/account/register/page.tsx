import { AuthForm } from "@/components/account/auth-form";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Create Account" };
export default function RegisterPage() { return <AuthForm action="register" mode={getStorefrontConfig().mode} />; }
