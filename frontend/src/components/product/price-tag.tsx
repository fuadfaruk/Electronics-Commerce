import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { discountPercent, formatBDT } from "@/lib/money";

const SIZES = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-2xl sm:text-3xl",
} as const;

export function PriceTag({
  price,
  compareAtPrice,
  size = "md",
  showDiscountBadge = false,
  className,
}: {
  price: number;
  compareAtPrice?: number;
  size?: keyof typeof SIZES;
  showDiscountBadge?: boolean;
  className?: string;
}) {
  const percent = discountPercent({ price, compareAtPrice });
  const hasDiscount =
    compareAtPrice !== undefined && compareAtPrice > price && percent > 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className={cn("font-semibold tabular-nums", SIZES[size])}>
        {formatBDT(price)}
      </span>

      {hasDiscount ? (
        <>
          <span className="text-sm text-muted-foreground line-through tabular-nums">
            {formatBDT(compareAtPrice)}
          </span>
          {showDiscountBadge ? (
            <Badge tone="accent">-{percent}%</Badge>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
