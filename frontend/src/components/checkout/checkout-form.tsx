"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { LogoutButton } from "@/components/account/logout-button";
import { CartLineRow } from "@/components/cart/cart-line-row";
import { ContactFields } from "@/components/checkout/contact-fields";
import { Button, buttonStyles } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { commerceGet, commerceMutation } from "@/lib/api/client";
import { parseCsrf, parseOrderReceipt, parseQuote } from "@/lib/api/decoders";
import { ApiRequestError, safeProblem } from "@/lib/api/errors";
import { useCart } from "@/lib/cart/store";
import { ATTEMPT_STORAGE_KEY, attemptMemory, clearAttempt, createAttempt, itemSignature, payloadHash, readAttempt, rememberAttempt, saveAttempt, type AttemptReference } from "@/lib/checkout/attempt";
import { checkoutPayload } from "@/lib/checkout/validation";
import { formatBDT } from "@/lib/money";
import { withStorageLock } from "@/lib/storage-lock";
import type { AccountDto, ApiProblem, CsrfDto, OrderReceiptDto, PlaceOrderRequest, QuoteDto } from "@/types/api";

export function CheckoutForm({ initialAccount, guestOnly = true }: { initialAccount: AccountDto | null; guestOnly?: boolean }) {
  const cart = useCart();
  const router = useRouter();
  const [security, setSecurity] = useState<CsrfDto | null>(null);
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [quotedItems, setQuotedItems] = useState("");
  const [expired, setExpired] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [attempt, setAttempt] = useState<AttemptReference | null>(null);
  const [receiptMissing, setReceiptMissing] = useState(false);
  const [receipt, setReceipt] = useState<OrderReceiptDto | null>(null);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [priceChanged, setPriceChanged] = useState(false);
  const lock = useRef(false);
  const preparing = useRef(false);
  const mounted = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const signature = itemSignature(cart.lines);
  // Returning to an old quantity must not revive a previously reviewed quote.
  if (quotedItems && quotedItems !== signature) {
    setQuotedItems("");
    setAcknowledged(false);
  }

  const initialize = async () => {
    const saved = readAttempt();
    try {
      const csrf = await commerceGet("Security/csrf", parseCsrf);
      if (!mounted.current) return;
      setSecurity(csrf);
      if (csrf.sessionExpired) setProblem(safeProblem(401));
      else if (initialAccount && csrf.account?.id !== initialAccount.id) setProblem(safeProblem(409, "IDENTITY_CHANGED"));
    } catch (error) {
      if (mounted.current) setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503));
    }
    if (!mounted.current) return;
    if (saved.reference) setAttempt(saved.reference);
    if (saved.unavailable) setNotice("Recovery storage is unavailable. Keep this tab open; do not reload or check out in another tab until your order is resolved.");
    if (saved.invalid) setNotice(guestOnly ? "A checkout reference could not be verified. Contact the store before placing another order." : "A checkout reference could not be verified. Check your order email or account history before placing another order.");
  };
  const initializeFromEffect = useEffectEvent(initialize);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    if (cart.hydrated && cart.source === "live") queueMicrotask(() => { if (active) void initializeFromEffect(); });
    const onStorage = (event: StorageEvent) => {
      if (event.key === ATTEMPT_STORAGE_KEY) {
        const saved = readAttempt();
        if (saved.reference) { setAttempt(saved.reference); setQuote(null); setAcknowledged(false); }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => { active = false; mounted.current = false; window.removeEventListener("storage", onStorage); };
  }, [cart.hydrated, cart.source]);

  useEffect(() => {
    if (!quote) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Date.parse(quote.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [quote]);

  useEffect(() => { if (receipt) receiptHeading.current?.focus(); }, [receipt]);

  const identityChanged = Boolean(initialAccount && security && security.account?.id !== initialAccount.id);
  const accountBlocked = identityChanged || (security?.ownerKind === "account" && (!security.account || !security.account.emailVerified || (guestOnly && !attempt)));
  const quoteMatches = Boolean(quote && quotedItems === signature && !expired && !quote.problems.length && quote.lines.length === cart.lines.length && quote.lines.every((l) => l.availableStock >= l.quantity));

  const finish = async (order: OrderReceiptDto, reference: AttemptReference) => {
    if (itemSignature(order.lines) !== itemSignature(reference.items)) throw new ApiRequestError({ status: 502, code: "INVALID_RESPONSE" });
    await cart.confirmPurchase(order.id, order.lines);
    await clearAttempt(reference);
    setAttempt(null);
    if (guestOnly) { setReceipt(order); return; }
    router.replace(`/orders/${order.id}`);
    router.refresh();
  };

  const requestQuote = async () => {
    if (lock.current || !security || accountBlocked || guestLimitReached || !cart.lines.length || attempt) return;
    const saved = readAttempt();
    if (saved.reference) { setAttempt(saved.reference); return; }
    lock.current = true; setBusy(true); setProblem(null); setFormError("");
    try {
      const items = cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
      const next = await commerceMutation("Checkout/quote", { items }, parseQuote, {
        mode: cart.source, expectedOwner: security.ownerKind, expectedAccountId: security.account?.id,
      });
      if (next.ownerKind !== security.ownerKind || (!next.problems.length && itemSignature(next.lines) !== itemSignature(items))) throw new ApiRequestError({ status: 502, code: "INVALID_RESPONSE" });
      setPriceChanged(next.money.total !== cart.totals.total || next.lines.some((l) => cart.lines.find((p) => p.productId === l.productId)?.unitPrice !== l.unitPrice));
      setQuote(next); setQuotedItems(itemSignature(items)); setAcknowledged(false); setExpired(Date.parse(next.expiresAt) <= Date.now());
      cart.reconcileQuote(next);
    } catch (error) {
      const failure = error instanceof ApiRequestError ? error.problem : safeProblem(503);
      setProblem(failure);
      if (failure.code === "GUEST_ORDER_LIMIT") setGuestLimitReached(true);
    }
    finally { lock.current = false; setBusy(false); }
  };

  const submitAttempt = async (reference: AttemptReference, payload: PlaceOrderRequest) => {
    if (!security || lock.current || accountBlocked) return;
    if (security.ownerKind !== reference.ownerKind) { setProblem(safeProblem(409, "IDENTITY_CHANGED")); return; }
    lock.current = true; setBusy(true); setProblem(null); setFormError("");
    try {
      const remembered = attemptMemory(reference);
      if (await payloadHash(payload) !== reference.payloadHash) {
        setFormError("These details do not match the original attempt. Re-enter the same contact, address and notes, or check for its receipt. A different order will not be sent.");
        return;
      }
      if (remembered?.unsubmitted) {
        const persisted = await withStorageLock(ATTEMPT_STORAGE_KEY, (shared) => shared && saveAttempt(reference));
        if (!persisted) { setNotice("No order was sent. Restore browser storage and cross-tab synchronization before retrying this original request."); return; }
        remembered.unsubmitted = false;
      }
      rememberAttempt(reference, remembered ?? { payload, ownerKind: security.ownerKind, accountId: security.account?.id });
      const order = await commerceMutation("Order", payload, parseOrderReceipt, {
        mode: cart.source, idempotencyKey: reference.idempotencyKey,
        expectedOwner: reference.ownerKind,
        expectedAccountId: remembered?.accountId ?? security.account?.id,
      });
      await finish(order, reference);
    } catch (error) {
      const failure = error instanceof ApiRequestError ? error.problem : safeProblem(503);
      setProblem(failure);
      // These failures explicitly reject acceptance; outages/auth/idempotency remain uncertain.
      if (failure.code === "GUEST_ORDER_LIMIT") {
        await clearAttempt(reference); setAttempt(null); setQuote(null); setAcknowledged(false); setGuestLimitReached(true);
        setNotice("The store already has an order for this guest. This additional attempt was rejected and will not be retried.");
      } else if (["QUOTE_EXPIRED", "PRICE_CHANGED", "STOCK_CHANGED", "VALIDATION_FAILED", "GUEST_CHECKOUT_REQUIRED"].includes(failure.code)) {
        await clearAttempt(reference); setAttempt(null); setQuote(null); setAcknowledged(false);
        setNotice("The store rejected this attempt. Review the form and request a fresh quote before placing an order.");
      } else setNotice("The checkout is not resolved. Keep this tab open; do not reload, place another order in any tab, or change identity. Use the original attempt below.");
    } finally { lock.current = false; setBusy(false); }
  };

  const confirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!quote || !security || !quoteMatches || !acknowledged || lock.current || preparing.current || accountBlocked || guestLimitReached) return;
    if (Date.parse(quote.expiresAt) <= Date.now()) { setExpired(true); setAcknowledged(false); return; }
    const result = checkoutPayload(new FormData(event.currentTarget), quote.quoteId, security.account?.email);
    if (!result.payload) { setFormError(result.error ?? "Check the form."); return; }
    const existing = readAttempt().reference;
    if (existing) { setAttempt(existing); setNotice("Another checkout is unresolved. Check its receipt before continuing."); return; }
    preparing.current = true;
    try {
      const reference = await withStorageLock(ATTEMPT_STORAGE_KEY, async (shared) => {
        const saved = readAttempt();
        if (saved.reference) { setAttempt(saved.reference); setNotice("Another checkout is unresolved. Check its receipt before continuing."); return null; }
        if (!shared || saved.unavailable || saved.invalid) {
          setNotice("A new checkout cannot be started safely because shared recovery is unavailable. Restore browser storage and cross-tab synchronization; original attempts can still be resolved.");
          return null;
        }
        const next = await createAttempt(result.payload!, quote.lines, security.ownerKind);
        const request = { payload: result.payload!, ownerKind: security.ownerKind, accountId: security.account?.id, unsubmitted: true };
        rememberAttempt(next, request);
        if (saveAttempt(next)) request.unsubmitted = false;
        else setNotice("No order was sent because its recovery reference could not be saved. Keep this tab open and restore browser storage before retrying the original request.");
        return next;
      });
      if (!reference) return;
      setAttempt(reference); setReceiptMissing(false);
      if (attemptMemory(reference)?.unsubmitted) return;
      await submitAttempt(reference, result.payload);
    } catch (error) { setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503)); }
    finally { preparing.current = false; }
  };

  const checkReceipt = async () => {
    if (!attempt || lock.current) return;
    lock.current = true; setBusy(true); setProblem(null); setReceiptMissing(false);
    try {
      await finish(await commerceGet(`Order/attempt/${attempt.idempotencyKey}`, parseOrderReceipt), attempt);
    } catch (error) {
      if (error instanceof ApiRequestError && error.problem.status === 404) {
        setReceiptMissing(true); setNotice("No accepted receipt was found for this owner and attempt. Retry only the exact original request; a new attempt key will not be created.");
      } else setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503));
    } finally { lock.current = false; setBusy(false); }
  };

  const replay = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!attempt || (!receiptMissing && !attemptMemory(attempt)?.unsubmitted) || !security) return;
    const original = attemptMemory(attempt);
    if (original) { await submitAttempt(attempt, original.payload); return; }
    if (!formRef.current) return;
    const result = checkoutPayload(new FormData(formRef.current), attempt.quoteId, security.account?.email);
    if (!result.payload) { setFormError(result.error ?? "Check the original details."); return; }
    await submitAttempt(attempt, result.payload);
  };

  if (!cart.hydrated) return <p role="status">Restoring your cart...</p>;
  if (cart.source === "mock") return <p>Sample browsing only. Checkout is disabled.</p>;
  if (receipt) return <section className="mx-auto max-w-2xl space-y-5 rounded-2xl border bg-surface p-5 sm:p-6">
    <header className="space-y-2"><p className="bench-strip">Guest checkout / receipt</p><h1 ref={receiptHeading} tabIndex={-1} className="text-2xl font-semibold">Order received</h1><p className="break-all font-mono text-sm">Order {receipt.number}</p><p className="text-sm text-muted-foreground">Your order details have been received and saved. No payment was taken online.</p></header>
    <ul className="divide-y">{receipt.lines.map((line) => <li key={line.productId} className="flex items-start justify-between gap-4 py-3 text-sm"><div className="min-w-0"><p className="break-words font-medium">{line.name}</p><p className="text-muted-foreground">Quantity: {line.quantity}</p></div><span className="shrink-0 font-mono">{formatBDT(line.lineTotal)}</span></li>)}</ul>
    <dl className="space-y-2 text-sm"><div className="flex justify-between gap-4"><dt>Subtotal</dt><dd>{formatBDT(receipt.money.subtotal)}</dd></div><div className="flex justify-between gap-4"><dt>Delivery charge</dt><dd>{formatBDT(receipt.money.delivery)}</dd></div><div className="flex justify-between gap-4 border-t pt-3 font-semibold"><dt>Order total</dt><dd>{formatBDT(receipt.money.total)}</dd></div></dl>
    <p className="text-xs text-muted-foreground">One order is allowed per guest. Keep your order number for any questions about your purchase.</p>
    <Link href="/products" className={buttonStyles({ variant: "secondary" })}>Continue browsing</Link>
  </section>;
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy={busy}>
    <section className="min-w-0 space-y-5">
      <header className="space-y-2"><p className="bench-strip">{guestOnly ? "Guest checkout / order review" : "Checkout / order review"}</p><h1 className="text-2xl font-semibold">Review and place your order</h1><p className="text-sm text-muted-foreground">A server-issued quote confirms price, delivery and availability. No payment is taken online. We will contact you to confirm the order and payment.</p>{guestOnly ? <p className="text-sm text-muted-foreground">No account is needed. One order is allowed per guest.</p> : null}</header>
      {notice || cart.notice ? <p role="status" className="rounded-xl border bg-warning-soft p-3 text-sm">{notice || cart.notice}</p> : null}
      {problem ? <ErrorNotice heading="Checkout needs attention" problem={problem} retryable={false} /> : null}
      {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
      {accountBlocked ? <div className="space-y-3 rounded-2xl border p-4">{guestOnly ? <><p className="text-sm">{attempt ? "Your account session changed or expired. Contact the store to resolve the original checkout; it will not switch to a guest." : "Checkout is currently guest-only. Sign out explicitly before starting a guest order."}</p>{!attempt ? <LogoutButton mode="live" accountId={security?.account?.id} redirectTo="/checkout" /> : null}</> : <><p className="text-sm">{identityChanged || security?.sessionExpired ? "Your account session changed or expired. Restore the same account to continue; checkout will not switch to a guest." : "Verify your account email before checkout."}</p><Link href={identityChanged || security?.sessionExpired ? "/account/login?next=%2Fcheckout" : "/account/resend"} className={buttonStyles({ variant: "secondary" })}>{identityChanged || security?.sessionExpired ? "Sign in again" : "Resend verification email"}</Link></>}</div> : null}
      {!security ? <Button variant="secondary" disabled={busy} onClick={() => void initialize()}>Retry security check</Button> : null}
      {attempt ? <section className="space-y-3 rounded-2xl border border-warning/40 bg-warning-soft p-4">
        <h2 className="font-semibold">Resolve the original checkout</h2>
        <p className="text-sm">Browser storage holds only a noncredential attempt reference. Contact and address details are never persisted.</p>
        {attemptMemory(attempt)?.unsubmitted ? <p className="text-sm">No order was submitted. Restore browser storage and cross-tab synchronization before retrying this original request.</p> : null}
        <p className="break-all font-mono text-xs">Attempt: {attempt.idempotencyKey}</p>
        <Button disabled={busy} onClick={checkReceipt}>Check for receipt</Button>
        {(receiptMissing || attemptMemory(attempt)?.unsubmitted) && attemptMemory(attempt) ? <Button variant="secondary" disabled={busy || accountBlocked} onClick={() => void replay()}>Retry the exact original request</Button> : null}
        {receiptMissing && !attemptMemory(attempt) ? <form ref={formRef} onSubmit={replay} className="space-y-4">
          <p className="text-sm">Re-enter the original details exactly. The saved payload hash must match before a replay is sent, using the same quote and key even if the quote expired.</p>
          <ContactFields account={security?.account} />
          <Button type="submit" disabled={busy || accountBlocked}>Replay the original checkout attempt</Button>
        </form> : null}
      </section> : cart.lines.length ? <form ref={formRef} onSubmit={confirm} className="space-y-5">
        <fieldset disabled={busy || Boolean(accountBlocked) || guestLimitReached} className="space-y-4"><legend className="mb-3 text-base font-semibold">Contact and delivery</legend><ContactFields account={security?.account} /></fieldset>
        <p className="text-xs text-muted-foreground">Details are sent only when you place your order. They are not saved to browser storage.</p>
        {quote && quoteMatches ? <label className="flex min-h-11 items-start gap-3 rounded-xl border bg-brand-soft p-3 text-sm"><input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /><span>I reviewed this quote and agree to the items, delivery charge and order total of {formatBDT(quote.money.total)}.</span></label> : null}
        <Button type="submit" size="lg" fullWidth disabled={busy || !quoteMatches || !acknowledged || !security || Boolean(accountBlocked) || guestLimitReached}>{busy ? "Resolving checkout..." : "Place order"}</Button>
      </form> : <div className="space-y-3"><p>Your cart is empty.</p><Link href="/products" className={buttonStyles({ variant: "secondary" })}>Browse products</Link></div>}
    </section>
    <aside className="min-w-0 space-y-4 rounded-2xl border bg-surface p-4">
      <h2 className="font-semibold">Your items</h2>
      <ul className="divide-y">{cart.lines.map((line) => <CartLineRow key={line.productId} line={line} />)}</ul>
      {quote ? <div className="space-y-3">
        {priceChanged ? <p role="status" className="text-sm text-warning">A price or delivery amount changed. Review and acknowledge this fresh quote.</p> : null}
        {expired ? <p role="status" className="text-sm text-warning">Quote expired. Request a fresh quote.</p> : null}
        {signature !== quotedItems ? <p role="status" className="text-sm text-warning">The cart changed. Request a new quote before confirming.</p> : null}
        {quote.problems.length ? <ul role="alert" className="space-y-1 text-sm text-danger">{quote.problems.map((p) => <li key={`${p.productId}-${p.code}`}>{p.message}</li>)}</ul> : null}
        <dl className="space-y-2 text-sm"><div className="flex justify-between"><dt>Quoted subtotal</dt><dd>{formatBDT(quote.money.subtotal)}</dd></div><div className="flex justify-between"><dt>Delivery</dt><dd>{formatBDT(quote.money.delivery)}</dd></div><div className="flex justify-between border-t pt-2 font-semibold"><dt>Quoted total</dt><dd>{formatBDT(quote.money.total)}</dd></div></dl>
      </div> : <p className="text-sm text-muted-foreground">Estimated total {formatBDT(cart.totals.total)}. A quote is required before confirmation.</p>}
      {!attempt ? <Button variant="secondary" fullWidth disabled={busy || !security || Boolean(accountBlocked) || guestLimitReached || !cart.lines.length} onClick={requestQuote}>{busy ? "Checking..." : quote ? "Refresh quote" : "Check price and availability"}</Button> : null}
    </aside>
  </div>;
}
