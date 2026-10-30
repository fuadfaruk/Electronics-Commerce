import { parseAccount, parseCategories, parseCategory, parseCatalogPage, parseCsrf, parseHome, parseMessage, parseOrder, parseOrderReceipt, parsePagedOrders, parseProduct, parseProductDetail, parseQuote, parseStock } from "@/lib/api/decoders";
import { ApiRequestError, readBoundedText } from "@/lib/api/errors";
import type { ResponseKind } from "@/lib/api/bff-policy";
import type { StorefrontMode } from "@/types/api";

export function decodeCommerce(kind: ResponseKind, value: unknown, mode: StorefrontMode = "live"): unknown {
  switch (kind) {
    case "catalog": return parseCatalogPage(value, mode);
    case "productDetail": return parseProductDetail(value, mode);
    case "home": return parseHome(value, mode);
    case "categories": return parseCategories(value);
    case "category": return parseCategory(value);
    case "product": return parseProduct(value, mode);
    case "stock": return parseStock(value);
    case "account": return parseAccount(value);
    case "csrf": return parseCsrf(value);
    case "quote": return parseQuote(value);
    case "receipt": return parseOrderReceipt(value);
    case "order": return parseOrder(value);
    case "orders": return parsePagedOrders(value);
    case "message": return parseMessage(value);
    case "empty": return null;
  }
}

export async function responseJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(response.headers.get("content-type") ?? "")) {
    throw new ApiRequestError({ status: 502, code: "INVALID_RESPONSE" });
  }
  try {
    return JSON.parse(await readBoundedText(response, 2_097_152));
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError({ status: 502, code: "INVALID_RESPONSE" });
  }
}
