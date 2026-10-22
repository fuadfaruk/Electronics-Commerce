import { EmailAction } from "@/components/account/email-action";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Verify Email" };
export default function VerifyPage() { return <EmailAction action="verify" mode={getStorefrontConfig().mode} />; }
