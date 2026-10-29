# ElectroMart Storefront

Next.js 16.4.2 App Router, React 19.2.8, TypeScript and Tailwind CSS, retaining the
existing light, phone-first visual design. Use Node 24.17.0, npm 12.x and `npm ci`.
See the root [README](../README.md) for MySQL, SMTP, Identity, deployment and release
gates. The source-of-truth implementation plan is the existing commerce MVP plan
under `.kilo/plans/`.

## Run

From this directory, provide server-only settings before starting or building:

```powershell
$env:STOREFRONT_MODE = 'live'
$env:API_BASE_URL = 'http://localhost:5249'
$env:STOREFRONT_URL = 'http://localhost:3000'
npm.cmd ci --registry=https://registry.npmjs.org/
npm.cmd run dev
```

Local loopback HTTP is supported for development; production remote API/storefront
origins require HTTPS. `STOREFRONT_MODE=mock` explicitly enables sample browsing,
with checkout/accounts/staff mutations disabled. Missing or invalid production mode
does not default to mock, and a live failure never falls back to sample data.
`API_BASE_URL` is server-only. Do not use obsolete `NEXT_PUBLIC_API_BASE_URL` or
`NEXT_PUBLIC_USE_MOCK_DATA` variables.

## Journeys

- Home and bounded product collections; managed category navigation and slug detail.
- `/products`: server-backed search/filter/sort/facets, 12-item pages and explicit
  append/deduplicate load-more. Filter state is shareable in the URL.
- `/products/[slug]`: gallery/specifications/related items and guarded add-to-cart.
- Portal cart drawer: keyboard trap, background inertness, scroll locking and focus
  restoration. Product images have a local fallback when a remote image fails.
- `/checkout`: contact/Bangladesh address validation, server quote review and
  acknowledged order submission. The store contacts the customer to confirm the
  order and payment; no online payment is collected. Customer messenger accounts
  are not required, and provider settings/requests never belong in the browser.
- `/orders/[id]`: immutable private receipt and fulfillment/payment tracking.
- `/account`: registration, email verification/resend, login/logout, reset,
  paged history, private detail and explicit guest-order claim.
- `/admin`: server/API-protected category/product management, versioned stock deltas,
  order snapshots/audit and permitted fulfillment/cancellation/cash commands.

## Data And Security

`src/types/api.ts` contains dedicated DTOs, not EF navigation entities.
`lib/api/decoders.ts` rejects malformed, fractional, zero or unsafe commerce values
instead of making a saleable fallback. Whole-BDT amounts and line totals must match
the API contract. Only imagery has a harmless local placeholder.

RSC reads use `lib/api/server.ts` and async cookies, with private `no-store` requests.
Browser requests use allowlisted same-origin `/api/bff/...` endpoints; the BFF never
accepts an arbitrary target URL or forwards caller-supplied ownership/Authorization
headers. Mutations obtain fresh backend CSRF tokens and check the expected owner.
An expired account checkout does not retry as guest. All authorization remains
enforced by backend Identity and ownership/Admin policies.

Cart storage is separately versioned for mock/live catalogs. Quantities are bounded
integers; invalid/legacy entries are visibly invalidated. Reconciliation uses a quote,
and confirmed purchases subtract only purchased quantities from the freshest cart,
preserving later additions. An uncertain checkout stores only a noncredential
quote/idempotency/hash/item reference; contact/address/passwords/proofs are never
saved to browser storage. Resolve the original receipt or replay exact details with
the original key before creating another attempt.

New checkout requires a usable Web Lock and a durably saved attempt reference.
Denied storage reads/writes or unavailable/rejected locks refuse new submission.
An unsaved request retains its original key in tab memory across SPA navigation,
but must persist it before sending; keep that tab open. Previously sent uncertain
attempts remain recoverable by original-key receipt/replay even after storage or
locks fail. Cart degradation is visible and tab-only, never a stale shared write.
Changing quantity invalidates quote review permanently, including changing back.

Email capability/verification/reset/claim proofs live in URL fragments and are
immediately stripped into tab memory. GET/mount never consumes them. Explicit
confirmation POSTs are required. Proofs are never forwarded through sign-in URLs,
analytics or browser storage. Error notices use safe messages/correlation IDs, not
raw upstream bodies, URLs, credentials or exceptions.

## Validate

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:coverage
npm.cmd run build
npm.cmd exec playwright install chromium
npm.cmd run test:e2e
npm.cmd audit --omit=dev
npm.cmd audit
```

Vitest includes utility, wire/config/BFF, cart/recovery, account and real DOM tests.
Playwright uses production Next output, the seeded API, MySQL 8.4 and actual local
SMTP capture on desktop and mobile. E2E requires `ELECTROMART_TEST_MYSQL` and
`ELECTROMART_TEST_SMTP=1`; it uses fresh `electromart_test_*` schemas, not production
data. Test traces/screenshots/video are disabled to avoid retaining email proofs.
Playwright writes artifacts under `test-results/playwright-artifacts`, preserving
`test-results/vitest.xml` alongside the browser JUnit report.

Local 2026-10-23 validation passes 273 frontend tests (90.44% line coverage), lint,
live typecheck, production build and 14 desktop/mobile browser tests over trusted
HTTPS. The user-approved 16.4.2 Next/lint update removes newly reported Next runtime
advisories; runtime npm audit is clean. The full audit remains strict: five high
`GHSA-vfj7-8cjw-p6xm` development findings remain, with no compatible patched
`braces` version. No security exception or promotion bypass has been approved.
Do not use `npm audit fix --force` to downgrade the Next tooling. Passing local
journeys is not release approval; paired packaging remains security-blocked.

## Local Artwork

Category `visualKey` values map to checked-in artwork. An unknown key uses a generic
accessories fallback, never remote HTML/SVG. Existing sample products and storefront
branding/policies are not production catalog or legal/support promises. The operator
must supply approved catalog/contact/delivery/warranty/privacy terms before release.
