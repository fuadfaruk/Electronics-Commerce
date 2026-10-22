import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import type { ApiProblem } from "@/types/api";

export function AccountAccess({ mock = false, problem, next = "/account", unverified = false }: {
  mock?: boolean; problem?: ApiProblem; next?: string; unverified?: boolean;
}) {
  return <section className="space-y-4">
    <h1 className="text-2xl font-semibold">{mock ? "Sample browsing only" : unverified ? "Verify your email" : "Your account"}</h1>
    {problem && ![401, 403].includes(problem.status) ? <ErrorNotice problem={problem} /> :
      <p className="text-sm text-muted-foreground">{mock ? "Accounts and private orders are disabled in mock mode. No live account request is made." : unverified ? "A verified account is required for order history and guest claims." : "Sign in to view your private account and order history."}</p>}
    {!mock ? <div className="flex flex-wrap gap-2">
      <Link href={unverified ? "/account/resend" : `/account/login?next=${encodeURIComponent(next)}`} prefetch={false} className={buttonStyles()}>{unverified ? "Resend verification" : "Sign in"}</Link>
      <Link href="/account/register" prefetch={false} className={buttonStyles({ variant: "secondary" })}>Create an account</Link>
    </div> : null}
  </section>;
}
