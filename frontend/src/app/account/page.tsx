import Link from "next/link";
import { AccountAccess } from "@/components/account/account-access";
import { LogoutButton } from "@/components/account/logout-button";
import { buttonStyles } from "@/components/ui/button";
import { getAccount } from "@/lib/account/server";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const account = await getAccount();
  if (!account || !account.ok) return <><AccountAccess mock={!account} problem={account && !account.ok ? account.problem : undefined} />{account && !account.ok && account.problem.status === 401 ? <div className="mt-4"><LogoutButton mode="live" /></div> : null}</>;
  return <section className="space-y-5"><header className="space-y-2"><h1 className="text-2xl font-semibold">{account.data.name}</h1><p className="break-all text-sm text-muted-foreground">{account.data.email}</p><p className="text-sm">Email {account.data.emailVerified ? "verified" : "not verified"}</p></header>
    <div className="flex flex-wrap gap-3"><Link href="/account/orders" prefetch={false} className={buttonStyles()}>View order history</Link>{!account.data.emailVerified ? <Link href="/account/resend" className={buttonStyles({ variant: "secondary" })}>Resend verification</Link> : null}{account.data.isAdmin ? <Link href="/admin" prefetch={false} className={buttonStyles({ variant: "secondary" })}>Staff dashboard</Link> : null}</div>
    <LogoutButton mode="live" accountId={account.data.id} />
  </section>;
}
