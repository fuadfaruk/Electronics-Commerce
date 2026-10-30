# ElectroMart

A electronics gadgets storefront with an ASP.NET Core/MySQL commerce API.
The current mode supports one order per guest, a simple acceptance receipt and a
protected staff dashboard for manual order/payment confirmation. Only the frontend,
backend and MySQL database are required. Customer accounts, private tracking, email
and private owner Telegram alerts are retained but disabled by default, so they can
be enabled later. Existing cash collection after delivery remains unchanged.
There is no online payment, advance-payment or refund integration.
This is not a production-release approval.

## Toolchain

| Component | Pinned version |
| --- | --- |
| Node / npm | Node 24.17.0 / npm 12.x |
| .NET SDK / target | 10.0.401 / net10.0 |
| EF Core / Identity / local EF CLI | 10.0.13 |
| Oracle EF MySQL provider | MySql.EntityFrameworkCore 10.0.12 |
| Connector/NET | MySql.Data 26.10.0 |
| Database | MySQL 8.4 LTS, InnoDB, utf8mb4 |
| Frontend | Next.js 16.4.2, React 19.2.8, TypeScript, Tailwind CSS |
| Testing | xUnit, real MySQL/SMTP HTTP tests, Vitest DOM tests, Playwright |

`global.json`, `.nvmrc`, `.config/dotnet-tools.json` and the frontend lockfile make
the supported toolchain reproducible. Pomelo and EF9 are no longer in the graph.
Canonical paths are `backend/ElectroApi.slnx`, `backend/src/ElectroApi.*` and
`backend/tests/ElectroApi.*.Tests`; do not add lowercase aliases.

## Local Development

Docker Compose provides a separate `electromart_mvp_dev` schema. Local SMTP capture
is optional and does not start by default. Provide local-only passwords in your shell; they are not supplied by the
repository. A privileged migration/test connection is distinct from the runtime
application user.

```powershell
$env:MYSQL_ROOT_PASSWORD = '<local-root-password>'
$env:MYSQL_PASSWORD = '<local-app-password>'
docker compose up -d --wait
dotnet tool restore
dotnet restore backend/ElectroApi.slnx
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ConnectionStrings__DefaultConnection = 'Server=127.0.0.1;Port=33084;Database=electromart_mvp_dev;User ID=root;Password=<local-root-password>;SslMode=Disabled;'
$env:Security__KeyPath = 'C:\LocalState\ElectroMart\keys'
$env:Storefront__Origin = 'http://localhost:3000'
dotnet run --project backend/src/ElectroApi.Api --no-launch-profile -- --migrate-dev --seed-dev
$env:ConnectionStrings__DefaultConnection = 'Server=127.0.0.1;Port=33084;Database=electromart_mvp_dev;User ID=electromart;Password=<local-app-password>;SslMode=Disabled;'
dotnet run --project backend/src/ElectroApi.Api --no-launch-profile --urls 'http://localhost:5249'
```

Create the key directory outside the checkout/deployment tree and grant access only
to the application identity. Local keys are not certificate-encrypted by default;
production requires encrypted persistent keys. The migration/seed CLI refuses a
nonlocal server or a database other than `electromart_mvp_dev`/`electromart_test_*`.
Seed refuses a nonempty catalog and labels all 17 products as development samples.
It does not reset, import or modify an existing production database.

In a frontend terminal, use the locked install and explicit server-only settings:

```powershell
$env:STOREFRONT_MODE = 'live'
$env:STOREFRONT_GUEST_ONLY = 'true'
$env:API_BASE_URL = 'http://localhost:5249'
$env:STOREFRONT_URL = 'http://localhost:3000'
npm.cmd ci --registry=https://registry.npmjs.org/
npm.cmd run dev
```

Run those npm commands from `frontend/`. `STOREFRONT_MODE=mock` explicitly enables
sample browsing without a backend; checkout, account actions and staff mutations
are disabled. Production requires an explicit mode and valid configuration. Live
failures never fall back to samples. Remove obsolete `NEXT_PUBLIC_API_BASE_URL` and
`NEXT_PUBLIC_USE_MOCK_DATA` settings; browser bundles must not contain API origins.

To test email later, start Mailpit explicitly with `docker compose --profile mail up -d --wait`.
Its UI is at `http://localhost:8025`, with SMTP on port 1025. All local recipient
addresses should be sample `example.com` addresses. Development OpenAPI and Scalar
are available only in Development; `/health/database` reports reachability without
revealing connection details.

## Feature Switches

The checked-in defaults use only the storefront, API and database:

| Setting | Current default | Behavior |
| --- | --- | --- |
| API `Commerce__GuestOnly` | `true` | Guest-only checkout, one accepted order per guest identity, no customer accounts or tracking. |
| Next.js `STOREFRONT_GUEST_ONLY` | `true` | Hide customer account navigation, disable customer pages/BFF routes and show a simple checkout receipt instead of tracking. |
| API `Mail__Enabled` | `false` | Do not enqueue or send email; SMTP settings are not required. |
| API `OwnerNotifications__Enabled` | `false` | Do not enqueue or send Telegram owner alerts; alerts are not a checkout prerequisite. |

Guest identity uses the existing protected 30-day browser cookie. Clearing/expiring
cookies or using another browser/device creates a new guest; this is not a verified
one-order-per-person limit. The database serializes new acceptances for an owner
using the existing receipt table. Cancelled and previously claimed guest orders
still count. Exact original-key replay and receipt recovery remain available and do
not create another order. No schema migration is needed for this limit.

Guest-only receipts contain the immutable order number, creation time, items and
totals, not current fulfillment/payment status or history. Contact email remains an
order contact detail; it does not send a confirmation or tracking link. Staff still
use `/admin` and the operator-provisioned login at `/account/login`. Existing account
sessions must explicitly sign out before starting a new guest checkout.

To restore customer accounts and tracking later, set API `Commerce__GuestOnly=false`
and Next.js `STOREFRONT_GUEST_ONLY=false`, then restart both applications together.
For IIS, change the matching value in the frontend `web.config` as well. Email must
be explicitly enabled with `Mail__Enabled=true` and valid SMTP configuration before
using registration or email-proof recovery. Telegram remains independently optional.
Disabled email/alert workers perform database-only retention cleanup; disabling does
not enqueue messages or backfill orders when an integration is re-enabled. Existing
unexpired queued messages can resume if sending is re-enabled before they age out.

## Staff Provisioning

There is no public role assignment or default admin password. A hosting operator
may provision a distinct account with explicitly supplied environment secrets:

```powershell
$env:Bootstrap__Email = '<operator-email>'
$env:Bootstrap__Password = '<strong-operator-password>'
dotnet run --project backend/src/ElectroApi.Api --no-launch-profile -- --bootstrap-admin
```

The command refuses to promote an existing customer account. Supply the same secure
database and key configuration as the target host. Remove bootstrap variables after
provisioning; do not put passwords in arguments, scripts, Git or build artifacts.
Role/active-state changes are checked from the database on every authenticated
request. Logout revokes all current sessions; password reset invalidates old cookies.

## Commerce Contract

- `GET /api/v1/Product` uses bounded paging (`pageSize=12`, maximum 100), token-AND
  search, OR within selected brands/categories, inclusive prices, stock and stable
  sorting. Facets describe the search-matched catalog before other filters.
- Product detail uses `/Product/by-slug/{slug}` or the GUID route. Home collections
  are bounded. `/Category` provides ordered navigation; archived category metadata
  remains available by slug and existing product references remain valid.
- Products have permanent unique slugs, a category FK, ordered images/specifications,
  positive whole-BDT prices and a concurrency version. Archive removes new-sale
  eligibility without destroying order references. Metadata saves never overwrite
  stock; staff use a signed delta, expected version, reason and idempotency key.
- `POST /Checkout/quote` merges bounded integer quantities, returns authoritative
  line prices/availability and a 15-minute owner-bound quote. It does not reserve
  stock. BDT delivery is 80 below 5000 and free at or above 5000.
- `POST /Order` accepts only quote/contact/address/notes with an `Idempotency-Key`.
  The API creates IDs, timestamps, ownership, line and contact/money snapshots.
  Exactly-once receipts, ordered row locks, conditional stock updates and bounded
  deadlock retries prevent overselling and same-key double acceptance.
  Guest-only mode additionally rejects a second accepted order for the same guest.
- `GET /Order/attempt/{key}` recovers an uncertain checkout under its original
  owner. Same-key exact replay resolves accepted attempts even after quote expiry.
  Changed key payloads are conflicts, not new orders. Browser recovery stores only
  quote/key/hash/source/item references, never contact details or credentials.
  Guest-only acceptance and recovery return an immutable receipt, not tracking data.
- New checkout requires usable Web Locks and a durably saved original-attempt
  reference. Denied storage reads/writes or rejected/unsupported locks refuse new
  submission; existing uncertain attempts retain original-key receipt/replay.
  Unsaved, known-unsubmitted attempts keep their key in tab memory and must persist
  it before retrying. Degraded carts are visibly tab-only and never overwrite shared
  storage. Quantity edits invalidate quote review even when reversed.
- When owner notifications are enabled, new acceptance atomically queues one
  separately protected owner alert alongside stock/order/receipt and optional customer email.
  Delivery happens after commit and never changes acceptance, stock or payment.
  Replay and original-key recovery do not enqueue another alert. Customer emails
  retain private tracking capabilities in the full customer-feature mode; those credentials are never forwarded.
- Fulfillment is `Pending -> Confirmed -> Shipped -> Delivered`; cancellation is
  allowed only before shipment and restores stock once. Payment is separately
  `Unpaid -> Collected`, allowed once after delivery for the full immutable amount.
  Collected records customer cash, not courier settlement. No post-shipment refund
  or return accounting is implemented.

## Security Boundaries

The browser calls allowlisted same-origin `/api/bff/...` routes. Only the Next server
knows `API_BASE_URL`; it forwards selected commerce cookies and separate
`Set-Cookie` headers, never arbitrary Authorization/owner headers or target URLs.
Every unsafe request needs the canonical Origin, permitted Fetch Metadata and the
backend antiforgery token from `GET /Security/csrf`. Direct API calls receive the
same authorization and antiforgery checks; there is no browser CORS bypass.

Backend Identity owns account verification, password hashing/lockout, sessions and
Admin policies. Cookies are HttpOnly, host-only, bounded, SameSite=Lax and Secure
in production. Security tokens must be refreshed after identity changes. Expired
account cookies cannot silently turn an uncertain account checkout into a guest.

When customer features are enabled, guest order IDs and email addresses do not authorize access. The original protected
checkout owner may read its own order, or an emailed opaque fragment capability can
be explicitly exchanged for a 30-minute per-order grant. Capability hashes are stored
instead of raw tokens. Links are stripped from the address bar and kept in tab
memory; GET/mount never consumes them. Claim requires a matching verified account,
a fresh 20-minute one-use emailed proof and explicit confirmation. Claim revokes
previous capabilities/grants and retains the original guest contact snapshot.

When email is enabled, recovery emails use generic responses to avoid account/order enumeration. A
certificate/ACL-protected Data Protection key ring protects queued email payloads.
SMTP retries use leases, bounded attempts and cancellation; sent/exhausted payloads
are scrubbed. Failed delivery does not undo an accepted order. Error responses use
fixed codes/details and correlation IDs, not database/SMTP exceptions or PII.

## Private Owner Alerts

Use a dedicated Telegram bot and the owner's fixed private chat. No WhatsApp
Business onboarding, payment gateway or customer messenger account is required.
There are no customer messenger buttons, browser bot requests, inbound webhook,
runtime `getUpdates` polling, bot commands or public setup/send/status endpoints.

1. Open the official verified BotFather account in Telegram and use `/newbot`.
   Keep its token in a protected secret store; never paste it into Git, build
   artifacts, chat, README, browser history, URLs opened in a browser or CLI arguments.
2. The owner opens the dedicated bot and sends `/start` in a private chat.
3. Use one authenticated `getUpdates` call to the official Telegram Bot API from a
   trusted local/server-side tool, reading the token from protected settings or a
   hidden prompt. Inspect the result locally: verify the owner's identity and
   `message.chat.type=private`, then take that owner's positive `message.chat.id`.
   Do not auto-bind the first stranger who messages the bot, use a third-party ID
   bot, or choose a username, group or channel. Remove captured setup responses.
4. Configure only the API process using the settings below. Startup validates
   enabled token syntax and positive signed 64-bit chat IDs without contacting
   Telegram. The token is not stored in an outbox payload. Each payload captures
   the configured private chat at acceptance, so later chat changes do not reroute
   already queued orders.

| API-only setting | Behavior |
| --- | --- |
| `OwnerNotifications__Enabled` | Checked-in default `false`; explicitly enable only with approved protected settings. |
| `Telegram__BotToken` | BotFather token from the protected hosting secret store. |
| `Telegram__OwnerChatId` | Owner's positive numeric private-chat ID within signed 64-bit range. |

Do not provide these settings to Next.js or use `NEXT_PUBLIC_` variables. Disabled
Development/CI sending does not enqueue alerts; enabling later never backfills old
orders. Previously queued payloads still age out while sending is disabled.
Disabled notifications no longer pause checkout in Production. The independent
`Commerce__CheckoutEnabled` deployment switch must still remain closed through
promotion; original-attempt reads and staff access remain available while paused.
An outage after configured acceptance instead queues protected retries; the customer
receives the ordinary private receipt, not provider failure details.

Alerts contain immutable acceptance-time contact/address/item/BDT/notes snapshots,
labelled Pending/Unpaid and awaiting manual confirmation/payment. Long orders are
sent completely in numbered plain-text parts below Telegram's 4096-character limit.
Each part repeats the stable order number and part index/count. Customer-written
fields are delimited and unsafe controls removed; no HTML/Markdown parse mode is
enabled. The credential-free canonical `/admin/orders/{id}` link directs staff to
current database state because alerts may be delayed or the order may have changed.
No application credentials, guest capabilities, email proofs or payment secrets are sent.

The separate worker uses conditional claims, fenced renewable three-minute leases
and sequential sends spaced at least one second apart per worker. Each request is
bounded to 15 seconds and a 64 KiB response. Progress is saved after each acknowledged
part; retries resume at the first unacknowledged part. Telegram `429 retry_after` is
honored, transient network/5xx retries back off up to one hour, permanent 400/401/403
errors stop, and attempts are limited to ten per part and 24 hours per pending
payload. Interrupted attempts remain counted. Expired active leases are reclaimed
before retry/cleanup, including after a process restart. Run one sending API worker
per dedicated bot for global one-second pacing; replicas fence individual rows but
do not share an in-memory provider cooldown.

One accepted order and one queued event do not guarantee exactly one Telegram
message. Telegram has no documented `sendMessage` idempotency key: timeouts or a
crash after sending but before progress persistence may duplicate the current part.
Stable labels and database review are required; never create another order to retry
an alert. Acknowledged sending is not proof the owner read or confirmed the order.
There are no later-staff-action alerts, resend dashboard or customer messenger alerts.

Complete, failed, exhausted and aged-out payloads are scrubbed, retaining only
non-PII event/order/progress/provider-ID/fixed-failure metadata. Sanitized operational
logs contain safe event/order IDs and fixed codes, not request/response bodies,
exceptions, customer PII or URLs. The dedicated transport dispatches directly through
.NET handlers, bypassing HTTP factory URL loggers and HttpClient/HttpMessageInvoker
request telemetry, and disables its .NET diagnostic spans.
Do not enable low-level HTTP diagnostics, request-body capture or platform/proxy URL
tracing for this client: Telegram embeds the token in its request path. Future
telemetry must retain this exclusion rather than exporting token-bearing URLs.

The fallback is the existing protected staff order list plus sanitized failure logs.
Accepted orders hold stock immediately and do not auto-expire when alerts fail.
Staff must review pending orders and, if appropriate, cancel before shipment through
existing audited controls. Fulfillment/payment records and the post-delivery full
cash-collection guard remain authoritative; alerts never perform those commands.

Telegram bot chats are cloud chats, not end-to-end encrypted. Approved privacy,
data-processing and release review must cover sending fulfillment/contact information
to the owner's private chat. Setup, outbound HTTPS connectivity and one sample
order's complete parts require explicit operator authorization before live rollout.
Ordinary implementation/tests use fake senders/HTTP handlers, not real bot credentials
or live customer data. Provider references: [BotFather setup](https://core.telegram.org/bots/tutorial#obtain-your-bot-token),
[sendMessage](https://core.telegram.org/bots/api#sendmessage),
[getUpdates](https://core.telegram.org/bots/api#getupdates).

## Required Production Settings

Provide values through protected hosting settings, not checked-in JSON or packages:

| API setting | Requirement |
| --- | --- |
| `ConnectionStrings__DefaultConnection` | Dedicated runtime MySQL user, `SslMode=VerifyFull` |
| `Storefront__Origin` | Exact canonical HTTPS origin |
| `AllowedHosts` | Explicit API host names, no wildcard |
| `Security__KeyPath` | Persistent absolute path outside deployment artifacts, restrictive ACL |
| `Security__KeyCertificateThumbprint` | LocalMachine/My certificate with private-key access for the app identity |
| `Security__TrustedProxies__0` etc. | Only verified proxy IPs, one forwarded hop |
| `Commerce__GuestOnly` | `true` for the current guest-only mode |
| `Mail__Enabled` | `false` for the current database-only mode |
| `Mail__Host`, `Mail__Port`, `Mail__Sender` | Approved SMTP service/sender only when email is enabled |
| `Mail__EnableSsl` | `true` in production when email is enabled |
| `Mail__Username`, `Mail__Password` | Protected SMTP secrets only when enabled and required |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `Commerce__CheckoutEnabled` | Keep `false` through deployment and post-deploy checks; explicitly set `true` only when the operator reopens checkout |
| `OwnerNotifications__Enabled` | `false` currently; optionally enable with approved private owner-alert processing |
| `Telegram__BotToken`, `Telegram__OwnerChatId` | Required only for enabled alerts: protected API-only bot token and verified positive private owner chat ID |

Frontend requires `STOREFRONT_MODE=live`, server-only `API_BASE_URL` and canonical
`STOREFRONT_URL`; keep `STOREFRONT_GUEST_ONLY=true` for the current mode. Remote HTTP URLs are rejected. Host-only cookies have no Domain
attribute. Production IIS requires the .NET10 Hosting Bundle, Node24 and
HttpPlatformHandler support for standalone Next.js. Verify the host rather than
assuming a legacy provider can run this stack.

## Validation

```powershell
dotnet build backend/ElectroApi.slnx
$env:ELECTROMART_TEST_MYSQL = 'Server=127.0.0.1;Port=33084;User ID=root;Password=<local-root-password>;SslMode=Disabled;'
dotnet test backend/ElectroApi.slnx --filter 'FullyQualifiedName!~Protected_outbox_delivers_through_real_local_SMTP_capture_and_scrubs_sent_payload' --collect:'XPlat Code Coverage' --logger trx
dotnet list backend/ElectroApi.slnx package --vulnerable --include-transitive
```

Each real-provider test creates a fresh `electromart_test_*` schema on MySQL 8.4.
The default command excludes the optional SMTP capture test. To include it, start
Mailpit, set `ELECTROMART_TEST_SMTP=1` and rerun without the filter. A missing SMTP
service is not evidence of a passing mail gate. Without the explicit MySQL connection
integration tests are reported skipped, not validated.
Owner-alert unit tests and focused MySQL outbox tests use synthetic configuration and
fake HTTP/senders. They do not authorize real messages. Enable local MySQL/SMTP
readiness only when the documented services are actually available; skipped durable
enqueue/lease/migration tests and missing desktop/mobile E2E are unvalidated gates.

```powershell
npm.cmd ci --registry=https://registry.npmjs.org/
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:coverage
npm.cmd run build
npm.cmd exec playwright install chromium
npm.cmd run test:e2e
npm.cmd audit --omit=dev
npm.cmd audit
```

Run npm commands from `frontend/` with explicit live settings and the MySQL test
variable. Default E2E uses the actual production Next build, seeded API and MySQL,
with email/Telegram disabled, on desktop and mobile. For the retained full customer
journeys, start optional Mailpit and set `ELECTROMART_EXTENDED_FEATURES=1` and
`ELECTROMART_TEST_SMTP=1` before `npm.cmd run test:e2e`. It does not run a dev server or substitute mocked
checkout responses. Optional `E2E_TLS_CERT`/`E2E_TLS_KEY` provide trusted local TLS;
never disable TLS verification to hide a certificate or hosting problem. Browser
traces/video/screenshots are disabled to avoid capturing email proofs.

Local validation on 2026-10-23 passed 273 frontend tests (90.44% line coverage),
lint, explicit-live typecheck, the Next.js 16.4.2 production build, 14 desktop/mobile
browser tests over trusted local HTTPS, and 14 release-automation regressions.
Retained pre-notification backend evidence passes 18 unit plus 43 real-MySQL/SMTP integration
tests with zero failures/skips; Debug/Release builds and framework-dependent publish
passed. Workflow/PowerShell syntax and tracked/untracked case-fold checks also pass.
Playwright artifacts are separate from Vitest JUnit output; both reports survive E2E,
and all owned API/Next/TLS test listeners were stopped after the run.

Owner-alert validation on 2026-10-30 passed the backend solution build with zero
warnings/errors, 192 unit tests, 38 non-service integration cases, 279 frontend
tests (90.44% line coverage), lint, explicit-live typecheck/production build and
39 release-automation regressions. The current EF model matches the additive
migration snapshot, and generated forward SQL was reviewed without applying it.
The 47 MySQL/SMTP-dependent cases were skipped: their explicit service settings
were absent and the local Docker Linux engine was unavailable. All 14 desktop/mobile
Playwright specs were discovered, but actual E2E stopped at missing-service
prerequisites. These durable enqueue/lease/migration/mail/browser gates remain
unvalidated, not passing evidence. No live Telegram messages, production migration
or deployment were performed or authorized by this validation.

Fresh audits found Next.js runtime advisories `GHSA-2464-fhr4-w9xw`,
`GHSA-673q-mjm6-r5xr` and `GHSA-p3m5-59mp-jv5r` in the former 16.3.8 pin. The user
approved updating Next.js and matching lint tooling to 16.4.2; React and unrelated
dependency versions were preserved. A clean locked install and full validation
passed after the update. Runtime npm and transitive NuGet audits now report zero
findings. The full npm audit still reports five development-only high findings
from `GHSA-vfj7-8cjw-p6xm` in the lint chain (`braces`/`micromatch`/`fast-glob`);
latest `braces` remains 3.0.3 with no published compatible patch. **Keep Gate Strict**
remains in force: no exception, force downgrade or deployment bypass is enabled.
Failed local security evidence (`revision:null`) correctly rejects package assembly.
No security-approved paired artifact, current-tail Linux CI run, actual IIS deployment
or failed-rollout rehearsal has been verified. Generated reports/coverage are ignored;
exact continuation evidence is recorded in the existing `.kilo/plans/` completion plan.

## Release And Migration

PR/push workflows validate one revision and prepare paired backend/frontend
artifacts only after required gates. Deployment is separate and manual, consumes
the same verified artifact pair, and must use a protected environment. No push,
hosting change, production migration, credential rotation or deployment is authorized
by an implementation/test run.

Before promotion, the operator must confirm Node24/.NET10/MySQL8.4/TLS support (plus SMTP if enabled),
key-store persistence/ACL/certificate access, environment protections, catalog and
approved delivery/warranty/privacy/contact policies, backups and reviewed migration
SQL. A MySQL production schema is not automatically reset or seeded. This initial
Oracle migration replaces the obsolete Pomelo development schema; preserved
production data requires a reviewed copy/cleanup/migration path, not an assumed
in-place upgrade. Fractional legacy prices must be audited/rejected or explicitly
rounded by an approved migration, never silently rounded by the storefront.

`20261029133804_OwnerOrderNotifications` is a forward additive migration from
`20261022123955_OracleCommerceInitial`: it only creates the protected notification
outbox, order FK and indexes. Review its generated MySQL SQL, keep checkout closed
for migration and paired API/frontend promotion, and preserve compatible rollback
artifacts/backups. It does not reset/seed production, change historical orders or
backfill notifications. Generating/reviewing SQL during implementation does not
authorize a production migration or live deployment.

Stop checkout and both application pools during contract-changing promotion. Deploy
the tested artifact pair, run post-deploy health/contract/auth checks, then reopen
checkout. Preserve the previous compatible pair and database backup. If either
deployment fails, remain in maintenance for operator recovery; restarting a mixed
contract pair is not an atomic rollback. Use reviewed SQL or an explicit migration
job, never migrate on each web-process startup.

The packaged API defaults `Commerce:CheckoutEnabled` to `false`. A hosting-level
`Commerce__CheckoutEnabled=true` overrides that file, so the operator must explicitly
close checkout before promotion and keep it closed during verification. The pause
rejects new quote and order-acceptance requests with a safe maintenance response;
catalog browsing, staff access and original-attempt receipt reads remain available.
An uncertain checkout must recover its original attempt rather than create a new key.
Promotion does not change protected hosting settings or reopen checkout automatically.

Previously committed database/publish-profile credentials were removed from current
source. **Rotate exposed credentials and audit history, remotes, PRs/forks, artifacts,
caches and saved hosting credentials.** Deleting source does not revoke credentials
or erase historical exposure. Do not rewrite Git history without separate approval.

## License

No license has been declared for this repository. Oracle Connector/NET is
`GPL-2.0-only WITH Universal-FOSS-exception-1.0`, not Pomelo's licensing. An operator
must confirm deployment/distribution licensing suitability or a commercial license
before release; technical compatibility is not a legal conclusion.
