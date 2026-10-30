"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { commerceMutation } from "@/lib/api/client";
import { parseMessage } from "@/lib/api/decoders";
import { ApiRequestError, safeProblem } from "@/lib/api/errors";
import { readAttempt } from "@/lib/checkout/attempt";
import type { ApiProblem, StorefrontMode } from "@/types/api";

export function LogoutButton({ mode, accountId, redirectTo = "/account/login" }: { mode: StorefrontMode; accountId?: string; redirectTo?: "/account/login" | "/checkout" }) {
  const router = useRouter();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const logout = async () => {
    if (lock.current || mode !== "live") return;
    if (readAttempt().reference) { setBlocked(true); return; }
    lock.current = true; setPending(true); setProblem(null);
    try {
      await commerceMutation("Auth/logout", {}, parseMessage, { mode, expectedAccountId: accountId });
      router.replace(redirectTo); router.refresh();
    } catch (error) { setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503)); }
    finally { lock.current = false; setPending(false); }
  };
  return <div className="space-y-3">
    <Button variant="secondary" disabled={pending || mode !== "live"} onClick={logout}>{pending ? "Signing out..." : "Sign out on all devices"}</Button>
    {blocked ? <p role="alert" className="text-sm">Resolve the earlier checkout before signing out. <Link href="/checkout" className="font-medium text-brand underline">Return to checkout</Link>.</p> : null}
    {problem ? <ErrorNotice problem={problem} retryable={false} /> : null}
  </div>;
}
