import "server-only";
import { validateStorefrontConfig } from "@/lib/api/config-validation";

export function getStorefrontConfig() {
  return validateStorefrontConfig(process.env);
}
