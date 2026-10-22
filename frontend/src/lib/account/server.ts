import "server-only";
import { getStorefrontConfig } from "@/lib/api/config";
import { parseAccount } from "@/lib/api/decoders";
import { getApiResult } from "@/lib/api/errors";
import { serverGet } from "@/lib/api/server";

export async function getAccount() {
  if (getStorefrontConfig().mode === "mock") return null;
  return getApiResult(() => serverGet("Auth/me", parseAccount));
}
