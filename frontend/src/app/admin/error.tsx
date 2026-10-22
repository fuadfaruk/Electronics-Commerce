"use client";

import Link from "next/link";
import { Button, buttonStyles } from "@/components/ui/button";

export default function AdminError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <section role="alert" className="space-y-4 rounded-2xl border border-danger/30 bg-white/80 p-5">
      <h1 className="text-xl font-semibold">Staff workspace could not be loaded</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">No change is submitted by retrying this page. If a command response was lost, check its current record before making another change.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => retry()}>Try loading again</Button>
        <Link href="/admin" prefetch={false} className={buttonStyles({ variant: "secondary" })}>Staff overview</Link>
      </div>
    </section>
  );
}
