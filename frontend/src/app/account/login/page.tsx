import { AuthForm } from "@/components/account/auth-form";
import { safeNext } from "@/lib/account/links";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Sign In" };
export default async function LoginPage({ searchParams }: PageProps<"/account/login">) {
  return <AuthForm action="login" mode={getStorefrontConfig().mode} next={safeNext((await searchParams).next)} />;
}
