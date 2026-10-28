# ElectroMart

A electronics gadgets storefront with an ASP.NET Core/MySQL commerce API.
The MVP supports cash on delivery (COD), verified customer accounts, private guest
tracking and a protected staff dashboard. There is no online payment integration.
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

Docker Compose provides a separate `electromart_mvp_dev` schema and local SMTP
capture. Provide local-only passwords in your shell; they are not supplied by the
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

Mailpit is at `http://localhost:8025`, with SMTP on port 1025. All local recipient
addresses should be sample `example.com` addresses. Development OpenAPI and Scalar
are available only in Development; `/health/database` reports reachability without
revealing connection details.

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
- `GET /Order/attempt/{key}` recovers an uncertain checkout under its original
  owner. Same-key exact replay resolves accepted attempts even after quote expiry.
  Changed key payloads are conflicts, not new orders. Browser recovery stores only
  quote/key/hash/source/item references, never contact details or credentials.
- New checkout requires usable Web Locks and a durably saved original-attempt
  reference. Denied storage reads/writes or rejected/unsupported locks refuse new
  submission; existing uncertain attempts retain original-key receipt/replay.
  Unsaved, known-unsubmitted attempts keep their key in tab memory and must persist
  it before retrying. Degraded carts are visibly tab-only and never overwrite shared
  storage. Quantity edits invalidate quote review even when reversed.
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

Guest order IDs and email addresses do not authorize access. The original protected
checkout owner may read its own order, or an emailed opaque fragment capability can
be explicitly exchanged for a 30-minute per-order grant. Capability hashes are stored
instead of raw tokens. Links are stripped from the address bar and kept in tab
memory; GET/mount never consumes them. Claim requires a matching verified account,
a fresh 20-minute one-use emailed proof and explicit confirmation. Claim revokes
previous capabilities/grants and retains the original guest contact snapshot.

Recovery emails use generic responses to avoid account/order enumeration. A
certificate/ACL-protected Data Protection key ring protects queued email payloads.
SMTP retries use leases, bounded attempts and cancellation; sent/exhausted payloads
are scrubbed. Failed delivery does not undo an accepted order. Error responses use
fixed codes/details and correlation IDs, not database/SMTP exceptions or PII.

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
| `Mail__Host`, `Mail__Port`, `Mail__Sender` | Approved SMTP service/sender |
| `Mail__EnableSsl` | `true` in production |
| `Mail__Username`, `Mail__Password` | Protected SMTP secrets if required |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `Commerce__CheckoutEnabled` | Keep `false` through deployment and post-deploy checks; explicitly set `true` only when the operator reopens checkout |

Frontend requires `STOREFRONT_MODE=live`, server-only `API_BASE_URL` and canonical
`STOREFRONT_URL`; remote HTTP URLs are rejected. Host-only cookies have no Domain
attribute. Production IIS requires the .NET10 Hosting Bundle, Node24 and
HttpPlatformHandler support for standalone Next.js. Verify the host rather than
assuming a legacy provider can run this stack.

## Validation

```powershell
dotnet build backend/ElectroApi.slnx
$env:ELECTROMART_TEST_MYSQL = 'Server=127.0.0.1;Port=33084;User ID=root;Password=<local-root-password>;SslMode=Disabled;'
$env:ELECTROMART_TEST_SMTP = '1'
dotnet test backend/ElectroApi.slnx --collect:'XPlat Code Coverage' --logger trx
dotnet list backend/ElectroApi.slnx package --vulnerable --include-transitive
```

Each real-provider test creates a fresh `electromart_test_*` schema on MySQL 8.4.
SMTP tests require actual Mailpit on 1025/8025; a missing service is not evidence of
a passing mail gate. Without the explicit MySQL connection integration tests are
reported skipped, not validated.

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

Run npm commands from `frontend/` with explicit live settings and the test-service
variables. E2E uses the actual production Next build, seeded API, MySQL and SMTP
capture, on desktop and mobile. It does not run a dev server or substitute mocked
checkout responses. Optional `E2E_TLS_CERT`/`E2E_TLS_KEY` provide trusted local TLS;
never disable TLS verification to hide a certificate or hosting problem. Browser
traces/video/screenshots are disabled to avoid capturing email proofs.

Local validation on 2026-10-23 passed 273 frontend tests (90.44% line coverage),
lint, explicit-live typecheck, the Next.js 16.4.2 production build, 14 desktop/mobile
browser tests over trusted local HTTPS, and 14 release-automation regressions.
Retained current-backend evidence passes 18 unit plus 43 real-MySQL/SMTP integration
tests with zero failures/skips; Debug/Release builds and framework-dependent publish
passed. Workflow/PowerShell syntax and tracked/untracked case-fold checks also pass.
Playwright artifacts are separate from Vitest JUnit output; both reports survive E2E,
and all owned API/Next/TLS test listeners were stopped after the run.

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

Before promotion, the operator must confirm Node24/.NET10/MySQL8.4/TLS/SMTP support,
key-store persistence/ACL/certificate access, environment protections, catalog and
approved delivery/warranty/privacy/contact policies, backups and reviewed migration
SQL. A MySQL production schema is not automatically reset or seeded. This initial
Oracle migration replaces the obsolete Pomelo development schema; preserved
production data requires a reviewed copy/cleanup/migration path, not an assumed
in-place upgrade. Fractional legacy prices must be audited/rejected or explicitly
rounded by an approved migration, never silently rounded by the storefront.

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
catalog browsing and existing private receipt/original-attempt reads remain available.
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
