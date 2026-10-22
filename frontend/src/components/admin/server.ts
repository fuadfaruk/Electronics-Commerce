import "server-only";

import { unstable_rethrow } from "next/navigation";
import { getStorefrontConfig } from "@/lib/api/config";
import { parseAccount } from "@/lib/api/decoders";
import { ApiRequestError } from "@/lib/api/errors";
import { serverGet } from "@/lib/api/server";
import type { AccountDto, ApiProblem } from "@/types/api";

export type AdminFailure = {
  ok: false;
  reason: "mock" | "unauthenticated" | "forbidden" | "error";
  problem?: ApiProblem;
};

export type AdminResult<T> = { ok: true; data: T; account: AccountDto } | AdminFailure;

function failure(error: unknown): AdminFailure {
  unstable_rethrow(error);
  if (error instanceof ApiRequestError) {
    return {
      ok: false,
      reason: error.problem.status === 401 ? "unauthenticated" : error.problem.status === 403 ? "forbidden" : "error",
      problem: error.problem,
    };
  }
  return { ok: false, reason: "error" };
}

export async function requireAdmin(): Promise<AdminResult<AccountDto>> {
  try {
    if (getStorefrontConfig().mode !== "live") return { ok: false, reason: "mock" };
    const account = await serverGet("Auth/me", parseAccount);
    if (!account.isAdmin) return { ok: false, reason: "forbidden" };
    return { ok: true, data: account, account };
  } catch (error) {
    return failure(error);
  }
}

export async function adminGet<T>(path: `Admin/${string}`, decode: (value: unknown) => T, query?: URLSearchParams): Promise<AdminResult<T>> {
  // Layouts persist across navigation; every protected read checks the API session again.
  const access = await requireAdmin();
  if (!access.ok) return access;
  try {
    const data = await serverGet(path, decode, query);
    return { ok: true, data, account: access.account };
  } catch (error) {
    return failure(error);
  }
}
