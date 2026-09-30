# ElectroMart — storefront frontend

The customer-facing storefront for an electronics and parts shop. Next.js App
Router, TypeScript, Tailwind CSS, phone-first.

**This app currently makes zero network requests.** The entire catalog is mock
data. It is designed to sit on top of the ASP.NET API in `../backend` — see the
[gap list](#backend-gap-list) for what that API still needs.

## Requirements

- Node.js 20.9 or newer (developed against 24.x)
- npm

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

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

Every screen reads the catalog through `src/lib/catalog/queries.ts`. That is the
only file that needs to change when the API is ready: each function becomes a
`fetch` and its result is passed through `apiProductToProduct` from
`src/lib/api/adapters.ts`.

The mock is intentionally richer than the API can express. The adapter
**synthesises** what is missing — missing brand becomes `"Unbranded"`, missing
category becomes `"Uncategorized"`, images fall back to a placeholder and specs
become an empty list — so it is obvious in code exactly what has to be added
server-side.

### Prices and totals

- Prices are whole BDT taka and VAT-inclusive, matching the `int`
  `ProductPrice` field. `Intl.NumberFormat` renders BDT as `"BDT 12,500"` rather
  than with the taka sign, so `src/lib/money.ts` composes `৳12,500` manually.
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
counts, and the API adapters and order payload. Components are verified by hand.

Before handing work back: `npm run build`, `npm run lint`, `npm test`.

## Backend gap list

`../backend` is read-only for this project and has not been modified. These are
the things the storefront will need from it. Nothing here is a criticism of the
learning project — it is a checklist for when the catalog goes live.

1. **No product endpoint.** `OrderController` is the only controller. The
   storefront needs list, by-slug and by-category endpoints.
2. **No `DbSet<Product>`.** `ApplicationDbContext` only declares `Orders`, so
   even with a controller there is nothing to query.
3. **`Product` is missing presentation fields:** image reference, category,
   brand and a slug. It has name, description, price and quantity only. Without
   these, the listing and detail screens can only show placeholders.
4. **`ProductPrice` is an `int`.** Fine for whole taka; it cannot represent
   minor units if you ever price in a currency with decimals.
5. **No CORS policy** in `Program.cs`. A browser app on another origin cannot
   call the API until one is added. (Not needed today — the app makes no calls.)
6. **No auth endpoint**, and `User` has no password or roles. That matches the
   guest-checkout design, but order history would need accounts.
7. **`Order.ProductIds` is a single `Guid`** while `Products` is a
   `List<Product>`. Neither can be right alongside the other; the adapter
   currently sends the first line id plus the full product list.
8. **`Order.Address` is a `List<string>`** rather than a structured address, so
   the frontend flattens form fields into ordered lines.
9. **`POST /api/Order` takes and returns the EF entity directly**, and the
   controller's own comments note both DTOs and API versioning as follow-ups.
   Untouched.

`src/types/api.ts` mirrors the entities as they are today, and
`src/lib/api/adapters.ts` maps them onto the richer UI shapes.

## Notes and placeholder values

- `SITE_NAME` in `src/lib/site.ts` is `"ElectroMart"` — a placeholder. Change it
  there and the header, footer and page titles follow.
- Product names, brands, specs and prices in `src/data/products.mock.ts` are
  invented sample data for layout purposes.
- The catalog has no ratings or review data on purpose: the backend cannot
  express it, and it is the kind of detail that clutters a shopping UI.
