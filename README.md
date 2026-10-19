# ElectroMart

A full-stack electronics and computer-parts storefront. The customer-facing app is a
phone-first [Next.js](https://nextjs.org/) storefront; the backend is an ASP.NET Core
Web API backed by MySQL through Entity Framework Core.

> **Status:** early development. The storefront reads from checked-in mock data by
> default and can switch to the live catalog with `NEXT_PUBLIC_USE_MOCK_DATA=false`.
> See [Project status](#project-status) for the remaining work.

## Features

**Storefront**

- Home page with category tiles, featured products and a deals rail.
- Product listing with search, category, brand, price and in-stock filters plus sorting.
  Filter state lives in the URL, so views can be shared and the back button works.
- Product detail pages with an image gallery, specifications, stock badges, related
  products and a sticky mobile buy bar.
- Slide-over cart with quantity editing, a free-delivery progress bar and live totals.
- Mobile-first layout: bottom navigation, bottom-sheet filters, 44px touch targets and
  safe-area padding.

**API**

- Versioned REST routes for products and orders (`/api/v1/...`).
- EF Core data access with repository interfaces and generated MySQL migrations.
- Product images and key/value specifications stored as owned/related records.
- OpenAPI document generated in development.

## Tech stack

| Area       | Technology                                                        |
| ---------- | ----------------------------------------------------------------- |
| Frontend   | Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4   |
| Backend    | .NET 10, ASP.NET Core Web API, Entity Framework Core 9, Pomelo MySQL |
| Database   | MySQL 8                                                           |
| Testing    | Vitest 5 (frontend), xUnit (backend)                              |
| Tooling    | ESLint 9, npm, `dotnet` CLI, EF Core tools                        |
| Deployment | GitHub Actions, IIS + Web Deploy, Next.js standalone output       |

## Repository layout

```text
backend/
  electro-api.slnx                 solution
  src/
    electroapi.api/                ASP.NET Core host, controllers, configuration
    electroapi.core/               entities, DTOs, enums, repository interfaces
    electroapi.infrastructure/     EF Core DbContext, repositories, migrations
  tests/
    electroapi.unit.tests/         xUnit unit test project
    electroapi.integration.tests/  xUnit integration test project

frontend/
  src/
    app/                           App Router routes (home, listing, detail)
    components/                    cart, catalog, layout, product, search, ui
    data/                          mock products and categories
    lib/                           cart, catalog, API adapters, formatting helpers
    types/                         frontend domain and API wire types
  public/placeholders/             SVG placeholder artwork

.github/workflows/                 backend and frontend deploy pipelines
```

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org/) 24.x (20.9 or newer)
- npm
- A MySQL 8 server
- Optional: the EF Core CLI (`dotnet tool install --global dotnet-ef`)

## Getting started

### 1. Clone the repository

```powershell
git clone https://github.com/fuadfaruk/Electronics-Commerce.git
cd Electronics-Commerce
```

### 2. Create the database

Create the schema and a MySQL user for the application:

```sql
CREATE DATABASE electro_api CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'electro'@'localhost' IDENTIFIED BY 'your-password';
GRANT ALL PRIVILEGES ON electro_api.* TO 'electro'@'localhost';
FLUSH PRIVILEGES;
```

### 3. Configure the API

The API reads the `DefaultConnection` connection string and uses Pomelo's MySQL
provider. `backend/src/electroapi.api/appsettings.json` currently contains a local
development connection string; override it for your machine rather than editing the
tracked file.

For local development, user secrets are the simplest option:

```powershell
dotnet user-secrets init --project backend/src/electroapi.api
dotnet user-secrets set "ConnectionStrings:DefaultConnection" `
  "Server=localhost;Port=3306;Database=electro_api;Uid=electro;Pwd=your-password;SslMode=None;" `
  --project backend/src/electroapi.api
```

Alternatively, set an environment variable for the current shell:

```powershell
$env:ConnectionStrings__DefaultConnection = "Server=localhost;Port=3306;Database=electro_api;Uid=electro;Pwd=your-password;SslMode=None;"
```

Do not commit real credentials. Remove the placeholder connection string from
`appsettings.json` before production.

### 4. Apply migrations and run the API

```powershell
dotnet ef database update `
  --project backend/src/electroapi.infrastructure `
  --startup-project backend/src/electroapi.api

dotnet run --project backend/src/electroapi.api
```

The HTTP profile listens on `http://localhost:5249`; the HTTPS profile uses
`https://localhost:7220`. In development, the OpenAPI document is available at
`http://localhost:5249/openapi/v1.json` (there is no Swagger UI).

To create a new migration after changing the model:

```powershell
dotnet ef migrations add <MigrationName> `
  --project backend/src/electroapi.infrastructure `
  --startup-project backend/src/electroapi.api
```

### 5. Run the storefront

```powershell
cd frontend
npm install
Copy-Item .env.local.example .env.local   # optional; only needed when wiring the API
npm run dev
```

The storefront runs at `http://localhost:3000`. It needs no API or environment
configuration while mock data is enabled. To use the live catalog, set
`NEXT_PUBLIC_USE_MOCK_DATA=false` in `.env.local` and make sure the API is running
on `NEXT_PUBLIC_API_BASE_URL`.

## Configuration

### Backend

| Setting                             | Where                                          | Purpose                              |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------ |
| `ConnectionStrings:DefaultConnection` | user secrets, environment, or `appsettings.json` | MySQL server, database and credentials |
| `ASPNETCORE_ENVIRONMENT`            | launch profile / environment                   | Enables development OpenAPI output   |

### Frontend

| Variable                     | Default                 | Purpose                                           |
| ---------------------------- | ----------------------- | ------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`   | `http://localhost:5249` | Base URL of the ASP.NET API                        |
| `NEXT_PUBLIC_USE_MOCK_DATA`  | `true`                  | `true` serves mock data; `false` reads `GET /api/v1/Product` |

`NEXT_PUBLIC_*` values are inlined at build time, so they must be present when
`npm run build` runs, not just at runtime.

## API reference

All routes are JSON and live under `/api/v1`. There is currently no authentication
or authorization.

| Method | Route                  | Description                                                        |
| ------ | ---------------------- | ------------------------------------------------------------------ |
| GET    | `/api/v1/Product`      | List all products                                                  |
| POST   | `/api/v1/Product`      | Create a product                                                   |
| GET    | `/api/v1/Order`        | List all orders                                                    |
| POST   | `/api/v1/Order`        | Create an order (always starts as `Pending`)                       |
| PUT    | `/api/v1/Order/{id}`   | Update the products and address of a pending order                 |
| PATCH  | `/api/v1/Order/{id}`   | Change an order's status                                           |
| GET    | `/api/v1/Test`         | Reachability check with a timestamp                                |

Example product payload:

```json
{
  "productSlug": "pixel-9-pro",
  "productName": "Pixel 9 Pro",
  "brandName": "Google",
  "productCategorySlug": "smartphones",
  "productDescription": "6.3-inch flagship with a triple camera.",
  "productPrice": 125000,
  "productComparePrice": 135000,
  "productStockQuantity": 8,
  "productImages": [
    { "url": "https://example.com/pixel-9-pro.jpg", "order": 0 }
  ],
  "productSpecifications": [
    {
      "productSpecificationKey": "Display",
      "productSpecificationValue": "6.3 inch LTPO OLED"
    },
    {
      "productSpecificationKey": "Storage",
      "productSpecificationValue": "256 GB"
    }
  ],
  "featured": true
}
```

Order statuses are `Pending`, `Paid`, `Shipped` and `Cancelled`.

## Data model

| Entity         | Notes                                                                 |
| -------------- | --------------------------------------------------------------------- |
| `Order`        | Order id, user id, product ids, product list, date, address lines, status |
| `User`         | Id, name and email only; no password or roles yet                     |
| `Product`      | Slug, name, brand, category slug, description, decimal price, compare price, stock, images, specs, featured |
| `ProductImage` | Image URL and display order for a product                             |
| `ProductSpecification` | Key/value specification owned by a product                    |

The database tables are `Orders`, `Products`, `ProductImage`, `ProductSpecification`
and `User`.

## Testing and quality checks

Frontend:

```powershell
cd frontend
npm test          # Vitest, one run
npm run lint      # ESLint
npm run typecheck # next typegen + tsc --noEmit
npm run build     # production build
```

Backend:

```powershell
dotnet build backend/electro-api.slnx
dotnet test backend/electro-api.slnx
```

The frontend tests cover cart totals (including the free-delivery boundary), catalog
filtering and sorting, money formatting, and the API adapters. The backend test
projects are currently scaffolds with placeholder tests.

## Deployment

Two GitHub Actions workflows deploy to IIS through Web Deploy (MonsterASP.NET):

- `.github/workflows/publish-backend.yml` runs on every push, publishes
  `electroapi.api` with the .NET 10 SDK and deploys it.
- `.github/workflows/publish-frontend.yml` runs on pushes that touch `frontend/**` or
  the workflow itself. It builds Next.js in standalone mode, assembles the deployment
  package and generates an IIS `web.config` using the HttpPlatformHandler.

Required repository secrets:

| Workflow | Secrets                                                                 |
| -------- | ----------------------------------------------------------------------- |
| Backend  | `BACK_WEBSITE_NAME`, `BACK_SERVER_COMPUTER_NAME`, `BACK_SERVER_USERNAME`, `BACK_SERVER_PASSWORD` |
| Frontend | `FRONT_WEBSITE_NAME`, `FRONT_SERVER_COMPUTER_NAME`, `FRONT_SERVER_USERNAME`, `FRONT_SERVER_PASSWORD` |

Optional repository variables for the frontend build: `NEXT_PUBLIC_API_BASE_URL` and
`NEXT_PUBLIC_USE_MOCK_DATA` (defaults to `true`).

## Project status

Working:

- Storefront UI with a switchable mock/API catalog, filtering, cart drawer and totals.
- Product list/create API with images and specifications.
- Order list/create/update/status API.
- MySQL schema and migrations.
- GitHub Actions deployment workflows for both halves.

Next steps:

- **Add catalog endpoints by slug and category.** The API currently supports only
  list-all and create; the frontend resolves slugs and filters in memory.
- **Include images and specifications in the product query.** `GetAllProductsAsync`
  currently returns both navigation lists empty.
- **Add CORS if browser-side API calls are introduced.** Catalog reads happen
  server-side today, so they are unaffected.
- **Build checkout.** There is no checkout page, order confirmation or order history;
  the cart lives only in the browser.
- **Add accounts.** `User` has no password or roles, and there is no auth endpoint.
- **Raise test coverage.** Replace the placeholder backend tests and add component
  tests.
- **Remove the development connection string** from `appsettings.json` and rotate any
  credentials that have been committed.

## License

No license has been declared for this repository.
