import { EmailAction } from "@/components/account/email-action";
import { getStorefrontConfig } from "@/lib/api/config";

export const metadata = { title: "Reset Password" };
export default function ResetPage() { return <EmailAction action="reset" mode={getStorefrontConfig().mode} />; }
