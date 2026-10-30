"use client";

import { commerceRoute, allowQuery } from "@/lib/api/bff-policy";
import { parseCsrf } from "@/lib/api/decoders";
import { ApiRequestError, readApiProblem } from "@/lib/api/errors";
import { responseJson } from "@/lib/api/response";
import type { OwnerKind, StorefrontMode } from "@/types/api";

async function request<T>(path: string, decode: (value: unknown) => T, init: RequestInit, query?: URLSearchParams): Promise<T> {
  // Feature switches are server-only; the BFF, not browser validation, enforces them.
  const route = commerceRoute(init.method ?? "GET", path.split("/"), false);
  if (!route) throw new ApiRequestError({ status: 404 });
  const params = allowQuery(query ?? new URLSearchParams(), route);
  let response: Response;
  try {
    response = await fetch(`/api/bff/${route.path}${params.size ? `?${params}` : ""}`, {
      ...init, credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiRequestError({ status: 503 });
  }
  if (!response.ok) throw new ApiRequestError(await readApiProblem(response));
  return decode(await responseJson(response));
}

export function commerceGet<T>(path: string, decode: (value: unknown) => T, query?: URLSearchParams): Promise<T> {
  return request(path, decode, { method: "GET", headers: { Accept: "application/json" } }, query);
}

export interface MutationOptions {
  mode: StorefrontMode;
  method?: "POST" | "PUT" | "DELETE" | "PATCH";
  query?: URLSearchParams;
  idempotencyKey?: string;
  expectedOwner?: OwnerKind;
  expectedAccountId?: string;
}

export async function commerceMutation<T>(path: string, body: unknown, decode: (value: unknown) => T, options: MutationOptions): Promise<T> {
  if (options.mode !== "live") throw new ApiRequestError({ status: 403, code: "MOCK_READ_ONLY" });
  // Fresh CSRF also establishes a durable guest cookie before guest quotes/writes.
  const security = await commerceGet("Security/csrf", parseCsrf);
  if (["Checkout/quote", "Order"].includes(path) && security.ownerKind === "account") {
    if (!security.account || security.sessionExpired) throw new ApiRequestError({ status: 401, code: "SIGN_IN_REQUIRED" });
    if (!security.account.emailVerified) throw new ApiRequestError({ status: 403, code: "EMAIL_NOT_VERIFIED" });
  }
  if ((options.expectedOwner && options.expectedOwner !== security.ownerKind) ||
    (options.expectedAccountId && options.expectedAccountId !== security.account?.id)) {
    throw new ApiRequestError({ status: 409, code: "IDENTITY_CHANGED" });
  }
  const headers = new Headers({ Accept: "application/json", "X-CSRF-Token": security.token });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  const result = await request(path, decode, {
    method: options.method ?? "POST", headers, body: body === undefined ? undefined : JSON.stringify(body),
  }, options.query);
  if (["Auth/login", "Auth/logout", "Auth/verify", "Auth/reset", "Guest/exchange", "Account/order-claims/complete"].includes(path)) {
    // Do not turn a successful identity operation into a retryable mutation when refresh fails.
    await commerceGet("Security/csrf", parseCsrf).catch(() => undefined);
  }
  return result;
}
