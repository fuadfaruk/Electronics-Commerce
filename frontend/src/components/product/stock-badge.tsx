import { Badge } from "@/components/ui/badge";
import { stockLevel } from "@/lib/catalog/stock";

/** Plain-language stock state. No urgency theatre — just what is true. */
export function StockBadge({ stock }: { stock: number }) {
  const level = stockLevel({ stock });

  if (level === "out") {
    return <Badge tone="danger">Out of stock</Badge>;
  }

  if (level === "low") {
    return <Badge tone="warning">Only {stock} left</Badge>;
  }

  return <Badge tone="success">In stock</Badge>;
}
