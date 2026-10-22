"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { OrderReceipt } from "@/components/orders/order-receipt";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { parseCapabilityFragment, takeFragment } from "@/lib/account/links";
import { commerceGet, commerceMutation } from "@/lib/api/client";
import { parseMessage, parseOrder } from "@/lib/api/decoders";
import { ApiRequestError, safeProblem } from "@/lib/api/errors";
import type { ApiProblem, ApiResult, OrderDto, StorefrontMode } from "@/types/api";

export function OrderTracking({ orderId, initial, mode }: { orderId: string; initial: ApiResult<OrderDto>; mode: StorefrontMode }) {
  const [order, setOrder] = useState(initial.ok ? initial.data : null);
  const [problem, setProblem] = useState<ApiProblem | null>(initial.ok ? null : initial.problem);
  const [hasCapability, setHasCapability] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [pending, setPending] = useState(false);
  const capability = useRef<string | null>(null);
  const captured = useRef(false);
  const lock = useRef(false);
  const capture = useEffectEvent(() => {
    if (captured.current && !window.location.hash) return;
    captured.current = true;
    const fragment = takeFragment();
    capability.current = parseCapabilityFragment(fragment);
    setHasCapability(Boolean(capability.current));
    setInvalidLink(Boolean(fragment && !capability.current));
  });
  useEffect(() => {
    const receive = () => capture();
    receive();
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);

  const refresh = async (exchange = false) => {
    if (lock.current || mode !== "live") return;
    takeFragment();
    lock.current = true; setPending(true); setProblem(null);
    try {
      if (exchange && capability.current) {
        await commerceMutation("Guest/exchange", { orderId, capability: capability.current }, parseMessage, { mode });
        capability.current = null; setHasCapability(false);
      }
      const receipt = await commerceGet(`Order/${orderId}`, parseOrder);
      if (receipt.id !== orderId) throw new ApiRequestError({ status: 502, code: "INVALID_RESPONSE" });
      setOrder(receipt);
    } catch (error) { setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503)); }
    finally { lock.current = false; setPending(false); }
  };
  return <div className="space-y-5" aria-busy={pending}>
    {hasCapability ? <section className="space-y-3 rounded-2xl border bg-brand-soft p-4"><h1 className="text-xl font-semibold">Unlock private guest tracking</h1><p className="text-sm">The email proof was removed from the address bar. Confirm below to exchange it for a short-lived, private order cookie. Opening this page does not consume the link.</p><Button disabled={pending} onClick={() => void refresh(true)}>{pending ? "Unlocking..." : "Unlock private order"}</Button></section> : null}
    {invalidLink ? <p role="alert" className="text-sm text-danger">This private email link is invalid. Reopen the original email link.</p> : null}
    {problem ? <ErrorNotice heading="Private order unavailable" problem={problem} retryable={false} /> : null}
    {order ? <OrderReceipt order={order} /> : !hasCapability ? <p className="text-sm text-muted-foreground">Use the original guest checkout browser, a private email link, or the owning account. An order ID or email address alone does not grant access.</p> : null}
    <div className="flex flex-wrap gap-4"><Button variant="secondary" disabled={pending || mode !== "live"} onClick={() => void refresh()}>Refresh private tracking</Button><Link href="/account/orders" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-medium text-brand">Account order history</Link></div>
  </div>;
}
