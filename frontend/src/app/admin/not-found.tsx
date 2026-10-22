import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function AdminNotFound() {
  return (
    <section className="space-y-4 py-6">
      <h1 className="text-2xl font-bold">Record not found</h1>
      <p className="text-sm text-muted-foreground">This record is unavailable or has been removed. Return to the staff lists for current data.</p>
      <Link prefetch={false} href="/admin" className={buttonStyles({ variant: "secondary" })}>Staff overview</Link>
    </section>
  );
}
