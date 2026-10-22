"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CartLineRow } from "@/components/cart/cart-line-row";
import { ContactFields } from "@/components/checkout/contact-fields";
import { Button, buttonStyles } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { commerceGet, commerceMutation } from "@/lib/api/client";
import { parseCsrf, parseOrder, parseQuote } from "@/lib/api/decoders";
import { ApiRequestError, safeProblem } from "@/lib/api/errors";
import { useCart } from "@/lib/cart/store";
import { ATTEMPT_STORAGE_KEY, attemptMemory, clearAttempt, createAttempt, itemSignature, payloadHash, readAttempt, rememberAttempt, saveAttempt, type AttemptReference } from "@/lib/checkout/attempt";
import { checkoutPayload } from "@/lib/checkout/validation";
import { formatBDT } from "@/lib/money";
import type { AccountDto, ApiProblem, CsrfDto, OrderDto, PlaceOrderRequest, QuoteDto } from "@/types/api";

export function CheckoutForm({ initialAccount }: { initialAccount: AccountDto | null }) {
  const cart = useCart();
  const router = useRouter();
  const [security, setSecurity] = useState<CsrfDto | null>(null);
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [quotedItems, setQuotedItems] = useState("");
  const [expired, setExpired] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [attempt, setAttempt] = useState<AttemptReference | null>(null);
  const [receiptMissing, setReceiptMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [priceChanged, setPriceChanged] = useState(false);
  const lock = useRef(false);
  const preparing = useRef(false);
  const mounted = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const signature = itemSignature(cart.lines);

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
    if (saved.unavailable) setNotice("Recovery storage is unavailable. Keep this tab open until your order is resolved.");
    if (saved.invalid) setNotice("A checkout reference could not be verified. Check your order email or account history before placing another order.");
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

  const identityChanged = Boolean(initialAccount && security && security.account?.id !== initialAccount.id);
  const accountBlocked = identityChanged || (security?.ownerKind === "account" && (!security.account || !security.account.emailVerified));
  const quoteMatches = Boolean(quote && quotedItems === signature && !expired && !quote.problems.length && quote.lines.length === cart.lines.length && quote.lines.every((l) => l.availableStock >= l.quantity));

  const finish = (order: OrderDto, reference: AttemptReference) => {
    if (itemSignature(order.lines) !== itemSignature(reference.items)) throw new ApiRequestError({ status: 502, code: "INVALID_RESPONSE" });
    cart.confirmPurchase(order.id, order.lines);
    clearAttempt(reference);
    setAttempt(null);
    router.replace(`/orders/${order.id}`);
    router.refresh();
  };

  const requestQuote = async () => {
    if (lock.current || !security || accountBlocked || !cart.lines.length || attempt) return;
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
    } catch (error) { setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503)); }
    finally { lock.current = false; setBusy(false); }
  };

  const submitAttempt = async (reference: AttemptReference, payload: PlaceOrderRequest) => {
    if (!security || lock.current || accountBlocked) return;
    if (security.ownerKind !== reference.ownerKind) { setProblem(safeProblem(409, "IDENTITY_CHANGED")); return; }
    const remembered = attemptMemory(reference);
    if (await payloadHash(payload) !== reference.payloadHash) {
      setFormError("These details do not match the original attempt. Re-enter the same contact, address and notes, or check for its receipt. A different order will not be sent.");
      return;
    }
    lock.current = true; setBusy(true); setProblem(null); setFormError("");
    rememberAttempt(reference, remembered ?? { payload, ownerKind: security.ownerKind, accountId: security.account?.id });
    try {
      const order = await commerceMutation("Order", payload, parseOrder, {
        mode: cart.source, idempotencyKey: reference.idempotencyKey,
        expectedOwner: reference.ownerKind,
        expectedAccountId: remembered?.accountId ?? security.account?.id,
      });
      finish(order, reference);
    } catch (error) {
      const failure = error instanceof ApiRequestError ? error.problem : safeProblem(503);
      setProblem(failure);
      // These failures explicitly reject acceptance; outages/auth/idempotency remain uncertain.
      if (["QUOTE_EXPIRED", "PRICE_CHANGED", "STOCK_CHANGED", "VALIDATION_FAILED"].includes(failure.code)) {
        clearAttempt(reference); setAttempt(null); setQuote(null); setAcknowledged(false);
        setNotice("The store rejected this attempt. Review the form and request a fresh quote before placing an order.");
      } else setNotice("The checkout is not resolved. Do not place another order or change identity; use the original attempt below.");
    } finally { lock.current = false; setBusy(false); }
  };

  const confirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!quote || !security || !quoteMatches || !acknowledged || lock.current || preparing.current || accountBlocked) return;
    if (Date.parse(quote.expiresAt) <= Date.now()) { setExpired(true); setAcknowledged(false); return; }
    const result = checkoutPayload(new FormData(event.currentTarget), quote.quoteId, security.account?.email);
    if (!result.payload) { setFormError(result.error ?? "Check the form."); return; }
    const existing = readAttempt().reference;
    if (existing) { setAttempt(existing); setNotice("Another checkout is unresolved. Check its receipt before continuing."); return; }
    preparing.current = true;
    try {
      const reference = await createAttempt(result.payload, quote.lines, security.ownerKind);
      const raced = readAttempt().reference;
      if (raced) { setAttempt(raced); setNotice("Another checkout is unresolved. Check its receipt before continuing."); return; }
      rememberAttempt(reference, { payload: result.payload, ownerKind: security.ownerKind, accountId: security.account?.id });
      if (!saveAttempt(reference)) setNotice("This attempt is held in tab memory only. Keep this tab open until it is resolved.");
      setAttempt(reference); setReceiptMissing(false);
      await submitAttempt(reference, result.payload);
    } catch (error) { setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503)); }
    finally { preparing.current = false; }
  };

  const checkReceipt = async () => {
    if (!attempt || lock.current) return;
    lock.current = true; setBusy(true); setProblem(null); setReceiptMissing(false);
    try {
      finish(await commerceGet(`Order/attempt/${attempt.idempotencyKey}`, parseOrder), attempt);
    } catch (error) {
      if (error instanceof ApiRequestError && error.problem.status === 404) {
        setReceiptMissing(true); setNotice("No accepted receipt was found for this owner and attempt. Retry only the exact original request; a new attempt key will not be created.");
      } else setProblem(error instanceof ApiRequestError ? error.problem : safeProblem(503));
    } finally { lock.current = false; setBusy(false); }
  };

  const replay = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!attempt || !receiptMissing || !security) return;
    const original = attemptMemory(attempt);
    if (original) { await submitAttempt(attempt, original.payload); return; }
    if (!formRef.current) return;
    const result = checkoutPayload(new FormData(formRef.current), attempt.quoteId, security.account?.email);
    if (!result.payload) { setFormError(result.error ?? "Check the original details."); return; }
    await submitAttempt(attempt, result.payload);
  };

  if (!cart.hydrated) return <p role="status">Restoring your cart...</p>;
  if (cart.source === "mock") return <p>Sample browsing only. Checkout is disabled.</p>;
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy={busy}>
    <section className="min-w-0 space-y-5">
      <header className="space-y-2"><p className="bench-strip">Checkout / cash on delivery only</p><h1 className="text-2xl font-semibold">Review and place your order</h1><p className="text-sm text-muted-foreground">A server-issued quote confirms price, delivery and availability. No payment is taken online.</p></header>
      {notice || cart.notice ? <p role="status" className="rounded-xl border bg-warning-soft p-3 text-sm">{notice || cart.notice}</p> : null}
      {problem ? <ErrorNotice heading="Checkout needs attention" problem={problem} retryable={false} /> : null}
      {formError ? <p role="alert" className="text-sm text-danger">{formError}</p> : null}
      {accountBlocked ? <div className="space-y-3 rounded-2xl border p-4"><p className="text-sm">{identityChanged || security?.sessionExpired ? "Your account session changed or expired. Restore the same account to continue; checkout will not switch to a guest." : "Verify your account email before checkout."}</p><Link href={identityChanged || security?.sessionExpired ? "/account/login?next=%2Fcheckout" : "/account/resend"} className={buttonStyles({ variant: "secondary" })}>{identityChanged || security?.sessionExpired ? "Sign in again" : "Resend verification email"}</Link></div> : null}
      {!security ? <Button variant="secondary" disabled={busy} onClick={() => void initialize()}>Retry security check</Button> : null}
      {attempt ? <section className="space-y-3 rounded-2xl border border-warning/40 bg-warning-soft p-4">
        <h2 className="font-semibold">Resolve the original checkout</h2>
        <p className="text-sm">Only a noncredential attempt reference was saved. Contact and address details are not stored.</p>
        <p className="break-all font-mono text-xs">Attempt: {attempt.idempotencyKey}</p>
        <Button disabled={busy} onClick={checkReceipt}>Check for receipt</Button>
        {receiptMissing && attemptMemory(attempt) ? <Button variant="secondary" disabled={busy || accountBlocked} onClick={() => void replay()}>Retry the exact original request</Button> : null}
        {receiptMissing && !attemptMemory(attempt) ? <form ref={formRef} onSubmit={replay} className="space-y-4">
          <p className="text-sm">Re-enter the original details exactly. The saved payload hash must match before a replay is sent, using the same quote and key even if the quote expired.</p>
          <ContactFields account={security?.account} />
          <Button type="submit" disabled={busy || accountBlocked}>Replay the original COD attempt</Button>
        </form> : null}
      </section> : cart.lines.length ? <form ref={formRef} onSubmit={confirm} className="space-y-5">
        <fieldset disabled={busy || Boolean(accountBlocked)} className="space-y-4"><legend className="mb-3 text-base font-semibold">Contact and delivery</legend><ContactFields account={security?.account} /></fieldset>
        <p className="text-xs text-muted-foreground">Details are sent only on confirmation. They are not saved to browser storage.</p>
        {quote && quoteMatches ? <label className="flex min-h-11 items-start gap-3 rounded-xl border bg-brand-soft p-3 text-sm"><input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /><span>I reviewed this quote and agree to pay {formatBDT(quote.money.total)} in cash on delivery.</span></label> : null}
        <Button type="submit" size="lg" fullWidth disabled={busy || !quoteMatches || !acknowledged || !security || Boolean(accountBlocked)}>{busy ? "Resolving checkout..." : "Place COD order"}</Button>
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
        <dl className="space-y-2 text-sm"><div className="flex justify-between"><dt>Quoted subtotal</dt><dd>{formatBDT(quote.money.subtotal)}</dd></div><div className="flex justify-between"><dt>Delivery</dt><dd>{formatBDT(quote.money.delivery)}</dd></div><div className="flex justify-between border-t pt-2 font-semibold"><dt>COD total</dt><dd>{formatBDT(quote.money.total)}</dd></div></dl>
      </div> : <p className="text-sm text-muted-foreground">Estimated total {formatBDT(cart.totals.total)}. A quote is required before confirmation.</p>}
      {!attempt ? <Button variant="secondary" fullWidth disabled={busy || !security || Boolean(accountBlocked) || !cart.lines.length} onClick={requestQuote}>{busy ? "Checking..." : quote ? "Refresh quote" : "Check price and availability"}</Button> : null}
    </aside>
  </div>;
}
