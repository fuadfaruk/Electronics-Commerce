import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That page does not exist, or the product has been removed from the
        catalog.
      </p>
      <div className="flex gap-2">
        <Link href="/" className={buttonStyles({ variant: "secondary" })}>
          Go home
        </Link>
        <Link href="/products" className={buttonStyles()}>
          Browse products
        </Link>
      </div>
    </div>
  );
}
