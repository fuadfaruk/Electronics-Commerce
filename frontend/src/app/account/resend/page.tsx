import { AuthForm } from "@/components/account/auth-form";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Resend Verification" };
export default function ResendPage() { return <AuthForm action="resend" mode={getStorefrontConfig().mode} />; }
