import Link from "next/link";

export const metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6"><nav aria-label="Customer account" className="flex flex-wrap gap-4 border-b pb-2 text-sm font-medium text-brand"><Link href="/account" prefetch={false} className="inline-flex min-h-11 items-center">Account</Link><Link href="/account/orders" prefetch={false} className="inline-flex min-h-11 items-center">Order history</Link></nav>{children}</div>;
}
