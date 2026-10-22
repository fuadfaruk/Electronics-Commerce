import { AuthForm } from "@/components/account/auth-form";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Forgot Password" };
export default function ForgotPage() { return <AuthForm action="forgot" mode={getStorefrontConfig().mode} />; }
