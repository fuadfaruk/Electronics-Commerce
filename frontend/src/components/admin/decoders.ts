import { ApiRequestError } from "@/lib/api/errors";

export function parseDeleted(value: unknown): null {
  if (value !== null) throw new ApiRequestError({ status: 502, code: "INVALID_RESPONSE" });
  return null;
}
