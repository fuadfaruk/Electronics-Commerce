import { Field, Input, inputStyles } from "@/components/ui/input";
import { DISTRICTS } from "@/lib/checkout/validation";
import type { AccountDto } from "@/types/api";

export function ContactFields({ account }: { account?: AccountDto }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="Recipient name" htmlFor="checkout-name"><Input id="checkout-name" name="name" autoComplete="shipping name" defaultValue={account?.name ?? ""} required minLength={2} maxLength={100} /></Field>
    <Field label="Email" htmlFor="checkout-email" hint={account ? "The verified account email is used for this order." : "Used as a contact detail for this order."}><Input id="checkout-email" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={account?.email ?? ""} readOnly={Boolean(account)} /></Field>
    <Field label="Bangladesh mobile number" htmlFor="checkout-phone"><Input id="checkout-phone" name="phone" type="tel" inputMode="tel" autoComplete="shipping tel" required maxLength={20} placeholder="01712345678" /></Field>
    <Field label="District" htmlFor="checkout-district"><select id="checkout-district" name="district" className={inputStyles} required defaultValue=""><option value="" disabled>Select district</option>{DISTRICTS.map((d) => <option key={d}>{d}</option>)}</select></Field>
    <div className="sm:col-span-2"><Field label="Street and house" htmlFor="checkout-street"><Input id="checkout-street" name="street" autoComplete="shipping address-line1" required minLength={5} maxLength={300} /></Field></div>
    <Field label="Area" htmlFor="checkout-area"><Input id="checkout-area" name="area" autoComplete="shipping address-line2" required minLength={2} maxLength={100} /></Field>
    <Field label="City or town" htmlFor="checkout-city"><Input id="checkout-city" name="city" autoComplete="shipping address-level2" required minLength={2} maxLength={100} /></Field>
    <Field label="Postcode (optional)" htmlFor="checkout-postcode"><Input id="checkout-postcode" name="postcode" inputMode="numeric" autoComplete="shipping postal-code" pattern="[0-9]{4}" maxLength={4} /></Field>
    <div className="sm:col-span-2"><Field label="Delivery notes (optional)" htmlFor="checkout-notes"><textarea id="checkout-notes" name="notes" maxLength={500} rows={3} className={`${inputStyles} h-auto py-3`} /></Field></div>
  </div>;
}
