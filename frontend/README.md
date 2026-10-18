# ElectroMart — storefront frontend

The customer-facing storefront for an electronics and parts shop. Next.js App
Router, TypeScript, Tailwind CSS, phone-first.

The catalog reads from checked-in mock data by default, so the app runs with no
backend. Set `NEXT_PUBLIC_USE_MOCK_DATA=false` to read the live catalog from
`GET /api/v1/Product` instead — every screen goes through the same data seam.
See the [gap list](#backend-gap-list) for what the API still needs.

## Requirements

- Node.js 20.9 or newer (developed against 24.x)
- npm

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000, mock data by default
```

To check the storefront against the API, copy `.env.local.example` to
`.env.local`, set `NEXT_PUBLIC_USE_MOCK_DATA=false`, start the backend, and
restart the dev server (public env values are inlined at startup).

| Script              | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Dev server with Turbopack                       |
| `npm run build`     | Production build (also type-checks the project)  |
| `npm start`         | Serve a production build                        |
| `npm run lint`      | ESLint                                          |
| `npm run typecheck` | `next typegen` + `tsc --noEmit`                 |
| `npm test`          | Vitest, once                                     |
| `npm run test:watch`| Vitest, watching                                |

## What is built

Four surfaces, and nothing else:

1. **Home** — search, category tiles, featured and deals rails.
2. **Product listing** (`/products`) — also where search lands. Category, brand,
   price and in-stock filters plus sorting, all held in the URL so results are
   shareable and the back button behaves. Filters live in a bottom sheet on
   phones.
3. **Product detail** (`/products/[slug]`) — swipeable gallery, specs, stock
   state, quantity capped at available stock, and a sticky buy bar on phones
   that appears once the main button has scrolled away.
4. **Cart drawer** — a slide-over available from every screen, with line
   editing, real totals and a free-delivery indicator.

Deliberately **not** built yet: checkout, cart page, order confirmation, order
tracking, wishlist, a dedicated search page, product variants, dark mode. Each
is a small addition on top of the current structure.

## Layout

```
src/
  app/                     routes (App Router)
  components/
    cart/                  drawer, lines, totals, free-delivery bar
    catalog/               filter sheet, sort, chips, category tiles, load-more
    layout/                header, bottom nav, footer
    product/               card, grid, gallery, specs, stepper, buy panel
    search/                global search field
    ui/                    button, badge, drawer, input, skeleton, icons
  data/                    mock catalog + categories (the only product source)
  lib/
    api/adapters.ts        domain <-> wire mapping, order payload builder
    api/products.ts        GET /api/v1/Product client
    cart/                  totals (pure) + pricing constants + store
    catalog/               filters (pure) + queries (the data seam)
    money.ts               ৳ formatting
    site.ts                site name and copy constants
  types/
    domain.ts              shapes the UI talks in
    api.ts                 1:1 mirror of the C# entities
public/placeholders/       checked-in SVG placeholder artwork
```

## The data layer, and how to swap it

Every screen reads the catalog through `src/lib/catalog/queries.ts`. The source
is chosen by `NEXT_PUBLIC_USE_MOCK_DATA`:

- `true` (default) returns `src/data/products.mock.ts` and makes no request.
- `false` calls `src/lib/api/products.ts`, which fetches
  `${NEXT_PUBLIC_API_BASE_URL}/api/v1/Product`, maps each row through
  `apiProductToProduct`, and lets the same filters and sort run on the result.

The fetch is server-side, so the API does not need CORS for these reads. It uses
`cache: "no-store"`, which also keeps catalog pages dynamic: a product added on
the server is visible on the next request without rebuilding the frontend.

The adapter is defensive about optional entity fields: a missing brand becomes
`"Unbranded"`, a missing category becomes `"Uncategorized"`, missing imagery
falls back to the category placeholder, missing prices and stock become zero,
and missing specifications become an empty list. Images are ordered by
`ProductImage.Order`, and specifications are mapped from the key/value pair.

### Prices and totals

- Prices are whole BDT taka and VAT-inclusive. The entity's `ProductPrice` is a
  `decimal?`, so the adapter rounds it and treats a missing value as zero.
  `Intl.NumberFormat` renders BDT as `"BDT 12,500"` rather than with the taka
  sign, so `src/lib/money.ts` composes `৳12,500` manually.
- Delivery fee and the free-delivery threshold live in
  `src/lib/cart/pricing.ts` (`৳80`, free over `৳5,000`). One place to change.
- `src/lib/cart/totals.ts` and `src/lib/catalog/filters.ts` are pure functions,
  which is why they carry the unit tests.

## Phone-first decisions

- Sticky header with the search on its own full-width row; a 56px bottom tab bar
  inside the thumb arc on phones, hidden from `md` up.
- One product column on phones, two at `sm`, three at `lg`, four at `xl`.
  Switching phones to a two-up grid is a one-line change in
  `components/product/product-grid.tsx`.
- Filters open as a bottom sheet rather than a sidebar.
- Primary controls are at least 44px tall; compact inline controls (filter chips,
  cart line removal) keep their visual size but carry an expanded 44px hit area.
- "Load more" instead of infinite scroll, so nothing shifts under a thumb mid-read.
- `viewport-fit=cover` plus safe-area padding on the nav and drawer footer.
- Light theme only, but every colour is a CSS variable in `globals.css`, so a
  dark theme means redefining values in one block.

## Testing

`npm test` covers the logic most likely to break silently: cart totals including
the exact free-delivery boundary, catalog search/filter/sort edge cases, facet
counts, the mock-backed catalog queries, the product API client's request and
error handling, and the API adapters and order payload. Components are verified
by hand.

Before handing work back: `npm run build`, `npm run lint`, `npm test`.

## Backend gap list

`../backend` is read-only for this project and has not been modified. These are
the things the storefront will need from it. Nothing here is a criticism of the
learning project — it is a checklist for when the catalog goes live.

1. **No product-by-slug endpoint.** The frontend reads the full list from
   `GET /api/v1/Product` and resolves the slug in memory.
2. **No category endpoint.** Category names and tile artwork still come from
   `src/data/categories.mock.ts`; products join to them by
   `ProductCategorySlug`. Unknown slugs display as "Uncategorized".
3. **`GetAllProductsAsync` does not `Include` images or specifications.** The
   mapper handles both lists, but EF returns them empty until the query loads
   the navigation properties, so detail pages fall back to placeholders.
4. **No paging, filtering or sorting on the endpoint.** The frontend fetches the
   full catalog per request and filters it server-side.
5. **`ProductPrice` is a `decimal?`.** The UI is whole taka, so the adapter
   rounds it and treats null as zero.
6. **No CORS policy** in `Program.cs`. Not needed for the current server-side
   catalog reads, but required if a browser component calls the API directly.
7. **No auth endpoint**, and `User` has no password or roles. That matches the
   guest-checkout design, but order history would need accounts.
8. **Order contracts are out of sync.** `ApiOrder` still models `id` and a
   single-string `productIds`, while `CreateOrderRequest` expects `orderId`,
   `userId` and a `List<Guid>`. The catalog works independently; order wiring
   needs its own pass before checkout.
9. **`Order.Address` is a `List<string>`** rather than a structured address, so
   the frontend flattens form fields into ordered lines.
10. **`POST /api/Order` takes and returns the EF entity directly**, and the
    controller's own comments note both DTOs and API versioning as follow-ups.

`src/types/api.ts` mirrors the entities as they are today, and
`src/lib/api/adapters.ts` maps them onto the richer UI shapes.

## Notes and placeholder values

- `SITE_NAME` in `src/lib/site.ts` is `"ElectroMart"` — a placeholder. Change it
  there and the header, footer and page titles follow.
- Product names, brands, specs and prices in `src/data/products.mock.ts` are
  invented sample data for layout purposes.
- The catalog has no ratings or review data on purpose: the backend cannot
  express it, and it is the kind of detail that clutters a shopping UI.
