import { randomUUID } from "node:crypto";
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import type { OrderReceiptDto, PlaceOrderRequest, QuoteDto } from "../src/types/api";

const origin = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const apiBase = process.env.API_BASE_URL ?? "http://localhost:5249";
const samplePath = "/products/sample-usb-c-cable";
const attemptStorageKey = "electro.checkout.attempt.v1.live";
const notificationUrl = /^https?:\/\/(?:[^/]+\.)?(?:telegram\.org|telegram\.me|t\.me|whatsapp\.com|wa\.me|sendgrid\.com|mailgun\.net)(?:[:/]|$)/i;

const test = base.extend<{ notificationRequests: string[] }>({
  notificationRequests: [async ({ context }, use) => {
    const requests: string[] = [];
    await context.route(notificationUrl, async (route) => {
      requests.push(new URL(route.request().url()).hostname);
      await route.abort("blockedbyclient");
    });
    await use(requests);
    expect(requests, "Guest checkout must not request an external notification provider.").toEqual([]);
  }, { auto: true }],
});

test.beforeAll(() => {
  for (const url of [origin, apiBase]) {
    const parsed = new URL(url);
    expect(["localhost", "127.0.0.1"]).toContain(parsed.hostname);
    expect(["http:", "https:"]).toContain(parsed.protocol);
  }
});

function receipt(value: unknown): OrderReceiptDto {
  expect(value).toBeTruthy();
  expect(Object.keys(value as object).sort()).toEqual(["createdAt", "id", "lines", "money", "number"]);
  const order = value as OrderReceiptDto;
  expect(order.id).toMatch(/^[a-f0-9-]{36}$/i);
  expect(order.number).toMatch(/^EM-/);
  expect(Number.isFinite(Date.parse(order.createdAt))).toBe(true);
  expect(Object.keys(order.money).sort()).toEqual(["currency", "delivery", "policyVersion", "subtotal", "total"]);
  expect(order.money.currency).toBe("BDT");
  expect(order.money.total).toBe(order.money.subtotal + order.money.delivery);
  expect(order.lines.length).toBeGreaterThan(0);
  for (const line of order.lines) {
    expect(Object.keys(line).sort()).toEqual(["lineTotal", "name", "productId", "quantity", "slug", "unitPrice"]);
    expect(line.quantity).toBeGreaterThan(0);
    expect(line.lineTotal).toBe(line.quantity * line.unitPrice);
  }
  expect(order.lines.reduce((sum, line) => sum + line.lineTotal, 0)).toBe(order.money.subtotal);
  return order;
}

async function post(request: APIRequestContext, path: string, data: unknown, key?: string, direct = false) {
  const security = await request.get("/api/bff/Security/csrf");
  expect(security.status()).toBe(200);
  const { token } = await security.json();
  return request.post(direct ? `${apiBase}/api/v1/${path}` : `/api/bff/${path}`, {
    headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "X-CSRF-Token": token, ...(key ? { "Idempotency-Key": key } : {}) },
    data,
  });
}

async function noCustomerNavigation(page: Page) {
  await expect(page.locator('a[href^="/account"]:not([href^="/account/login"]), a[href^="/orders"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create account|forgot password|order history|track (?:your )?order/i })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/private order tracking|email (?:link|claim)|claim your order|order history/i);
}

async function confirmation(page: Page, order: OrderReceiptDto) {
  await expect(page.getByRole("heading", { name: "Order received", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/checkout(?:\?.*)?$/);
  await expect(page.getByText(`Order ${order.number}`, { exact: true })).toBeVisible();
  for (const line of order.lines) await expect(page.getByText(line.name, { exact: true })).toBeVisible();
  await expect(page.getByText("Order total", { exact: true }).locator("..")).toContainText(order.money.total.toLocaleString("en-BD"));
  await expect(page.locator("main")).not.toContainText(/\b(?:Pending|Confirmed|Shipped|Delivered|Cancelled|Unpaid|Collected|Fulfillment)\b|payment status|order updates|tracking|email link/i);
  await expect(page.getByRole("button", { name: /refresh|reload|track|unlock|claim/i })).toHaveCount(0);
  await noCustomerNavigation(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function prepare(page: Page, email: string): Promise<QuoteDto> {
  await page.goto(samplePath);
  await page.getByRole("button", { name: /add to cart/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goto("/checkout");
  await page.getByLabel("Recipient name").fill("Sample Guest Customer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Bangladesh mobile number").fill("01712345678");
  await page.getByLabel("District", { exact: true }).selectOption("Dhaka");
  await page.getByLabel("Street and house").fill("123 Sample Road");
  await page.getByLabel("Area", { exact: true }).fill("Sample Area");
  await page.getByLabel("City or town").fill("Dhaka");
  await page.getByLabel("Postcode (optional)").fill("1205");
  const result = page.waitForResponse((response) => response.url().endsWith("/Checkout/quote") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Check price and availability" }).click();
  const response = await result;
  expect(response.status()).toBe(200);
  const quote = await response.json() as QuoteDto;
  expect(quote.ownerKind).toBe("guest");
  expect(quote.problems).toEqual([]);
  await page.getByRole("checkbox", { name: /I reviewed this quote/ }).check();
  return quote;
}

async function place(page: Page) {
  const result = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/bff/Order" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Place order", exact: true }).click();
  const response = await result;
  expect(response.status()).toBe(200);
  const order = receipt(await response.json());
  const key = response.request().headers()["idempotency-key"];
  expect(key).toMatch(/^[a-f0-9-]{36}$/i);
  const payload = response.request().postDataJSON() as PlaceOrderRequest;
  await confirmation(page, order);
  return { order, key, payload };
}

async function staffLogin(page: Page) {
  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "Staff sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/login\?/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/admin/orders");
  await expect(page.getByRole("heading", { name: "Staff sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Account options" })).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill("operator@example.com");
  await page.getByLabel("Password", { exact: true }).fill("E2eOperator1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
}

test("catalog, mobile cart and persisted items remain available without customer navigation", async ({ page }) => {
  await page.goto("/");
  await noCustomerNavigation(page);
  await page.goto("/products");
  await page.getByRole("button", { name: /load more/i }).click();
  await expect(page.getByRole("link", { name: /Sample USB-C Cable/ }).first()).toBeVisible();
  await page.goto("/products?q=samsung+galaxy&brand=Samsung&stock=in");
  await expect(page.getByRole("link", { name: /Galaxy S24/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /MacBook/ })).toHaveCount(0);
  await page.goto(samplePath);
  await page.getByRole("button", { name: /add to cart/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /cart/i }).first().click();
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.keyboard.press("Escape");
  await page.reload();
  await page.goto("/checkout");
  await expect(page.getByText("Sample USB-C Cable", { exact: true })).toBeVisible();
  await noCustomerNavigation(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("customer pages, tracking and email-proof APIs are unavailable while staff sign-in stays accessible", async ({ page, context }) => {
  const id = randomUUID();
  for (const path of ["/account", "/account/register", "/account/forgot", "/account/resend", "/account/verify", "/account/reset", "/account/claim", "/account/orders", `/account/orders/${id}`, `/orders/${id}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
    await noCustomerNavigation(page);
  }
  for (const prefix of ["/api/bff", `${apiBase}/api/v1`]) {
    for (const path of [`Order/${id}`, "Account/orders", `Account/orders/${id}`]) {
      expect((await context.request.get(`${prefix}/${path}`)).status()).toBe(404);
    }
  }
  const disabled: [string, unknown][] = [
    ["Auth/register", { name: "Sample Customer", email: "unused@example.com", password: "SampleCustomer1!" }],
    ["Auth/verify", { userId: id, token: "non-live-proof" }],
    ["Auth/resend", { email: "unused@example.com" }],
    ["Auth/forgot", { email: "unused@example.com" }],
    ["Auth/reset", { userId: id, token: "non-live-proof", password: "SampleCustomer1!" }],
    ["Guest/exchange", { orderId: id, capability: "non-live-capability" }],
    ["Account/order-claims/request", { orderId: id }],
    ["Account/order-claims/complete", { claimId: id, proof: "non-live-proof" }],
  ];
  for (const direct of [false, true]) {
    for (const [path, data] of disabled) expect((await post(context.request, path, data, undefined, direct)).status()).toBe(404);
  }
  expect((await context.request.get("/api/bff/Auth/me")).status()).toBe(401);
  expect((await context.request.get("/api/bff/Admin/orders")).status()).toBe(401);
  const forged = await context.request.post("/api/bff/Auth/login", { headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" }, data: { email: "operator@example.com", password: "E2eOperator1!" } });
  expect(forged.status()).toBe(403);
  expect([400, 403, 404]).toContain((await context.request.get("/api/bff/https://attacker.example/anything")).status());
  await page.goto("/account/login?next=%2Fadmin%2Forders");
  await expect(page.getByRole("heading", { name: "Staff sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Account options" })).toHaveCount(0);
});

test("one protected guest order, exact replay and independent browser checkout preserve staff-only operations", async ({ page, context, browser }, testInfo) => {
  const staffContext = await browser.newContext({ baseURL: origin, viewport: page.viewportSize(), isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
  const independent = await browser.newContext({ baseURL: origin, viewport: page.viewportSize(), isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch });
  await staffContext.route(notificationUrl, (route) => route.abort("blockedbyclient"));
  await independent.route(notificationUrl, (route) => route.abort("blockedbyclient"));
  try {
    const staff = await staffContext.newPage();
    await staffLogin(staff);
    const initialCount = (await (await staffContext.request.get("/api/bff/Admin/orders")).json()).totalCount;
    const email = `guest-${testInfo.project.name}-${randomUUID()}@example.com`;
    const quote = await prepare(page, email);
    const productId = quote.lines[0].productId;
    const stock = (await (await context.request.get(`/api/bff/Product/${productId}`)).json()).product.stock;
    const pending = await post(context.request, "Checkout/quote", { items: [{ productId, quantity: 1 }] });
    expect(pending.status()).toBe(200);
    const secondQuote = await pending.json() as QuoteDto;
    expect(secondQuote.quoteId).not.toBe(quote.quoteId);
    const guest = (await context.cookies()).find((cookie) => cookie.name === "ElectroMart.Guest")!;
    expect(guest).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(await page.evaluate(() => document.cookie)).not.toContain("ElectroMart.Guest");
    const accepted = await place(page);
    for (const direct of [false, true]) {
      const replay = await post(context.request, "Order", accepted.payload, accepted.key, direct);
      expect(replay.status()).toBe(200);
      expect(receipt(await replay.json())).toEqual(accepted.order);
      const attempt = await context.request.get(direct ? `${apiBase}/api/v1/Order/attempt/${accepted.key}` : `/api/bff/Order/attempt/${accepted.key}`);
      expect(attempt.status()).toBe(200);
      expect(receipt(await attempt.json())).toEqual(accepted.order);
      const rejected = await post(context.request, "Order", { ...accepted.payload, quoteId: secondQuote.quoteId, notes: "A distinct second order" }, randomUUID(), direct);
      expect(rejected.status()).toBe(409);
      expect((await rejected.json()).code).toBe(direct ? "guest_order_limit" : "GUEST_ORDER_LIMIT");
    }
    const conflict = await post(context.request, "Order", { ...accepted.payload, notes: "Changed original details" }, accepted.key);
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await (await staffContext.request.get("/api/bff/Admin/orders")).json()).totalCount).toBe(initialCount + 1);
    expect((await (await context.request.get(`/api/bff/Product/${productId}`)).json()).product.stock).toBe(stock - 1);
    expect((await context.cookies()).find((cookie) => cookie.name === guest.name)?.value).toBe(guest.value);

    const otherPage = await independent.newPage();
    await prepare(otherPage, email);
    const otherOrder = await place(otherPage);
    expect(otherOrder.order.id).not.toBe(accepted.order.id);
    expect((await independent.cookies()).find((cookie) => cookie.name === guest.name)?.value).not.toBe(guest.value);
    expect((await independent.request.get(`/api/bff/Order/attempt/${accepted.key}`)).status()).toBe(404);
    expect((await (await staffContext.request.get("/api/bff/Admin/orders")).json()).totalCount).toBe(initialCount + 2);

    await staff.goto(`/admin/orders/${accepted.order.id}`);
    await expect(staff.getByRole("heading", { name: `Order ${accepted.order.number}`, exact: true })).toBeVisible();
    const staffOrder = await (await staffContext.request.get(`/api/bff/Admin/orders/${accepted.order.id}`)).json();
    expect(staffOrder.contact.email).toBe(email);
    expect(staffOrder.fulfillment).toBe("Pending");
    expect(staffOrder.payment).toBe("Unpaid");
    await staff.getByLabel("Action", { exact: true }).selectOption("cancel");
    await staff.getByLabel("Cancellation reason").fill("Sample cancelled before shipment");
    await staff.getByRole("checkbox", { name: /I reviewed order/ }).check();
    await staff.getByRole("button", { name: "Cancel before shipment", exact: true }).click();
    await expect(staff.getByText("Cancelled", { exact: true }).first()).toBeVisible();
    const stillLimited = await post(context.request, "Order", { ...accepted.payload, quoteId: secondQuote.quoteId }, randomUUID(), true);
    expect(stillLimited.status()).toBe(409);
    expect((await stillLimited.json()).code).toBe("guest_order_limit");

    await staff.goto(`/admin/orders/${otherOrder.order.id}`);
    for (const [action, label] of [["Confirmed", "Confirm order"], ["Shipped", "Mark shipped"], ["Delivered", "Mark delivered"]]) {
      await staff.getByLabel("Action", { exact: true }).selectOption(action);
      await staff.getByRole("checkbox", { name: /I reviewed order/ }).check();
      await staff.getByRole("button", { name: label, exact: true }).click();
      await expect(staff.getByText(action, { exact: true }).first()).toBeVisible();
    }
    await staff.getByRole("checkbox", { name: /full customer cash payment/ }).check();
    await staff.getByRole("button", { name: "Record customer cash received", exact: true }).click();
    await expect(staff.getByText("Collected", { exact: true }).first()).toBeVisible();
    for (const [owner, original] of [[context.request, accepted], [independent.request, otherOrder]] as const) {
      for (const direct of [false, true]) {
        const replay = await post(owner, "Order", original.payload, original.key, direct);
        expect(replay.status()).toBe(200);
        expect(receipt(await replay.json())).toEqual(original.order);
        const prefix = direct ? `${apiBase}/api/v1` : "/api/bff";
        const attempt = await owner.get(`${prefix}/Order/attempt/${original.key}`);
        expect(attempt.status()).toBe(200);
        expect(receipt(await attempt.json())).toEqual(original.order);
        expect((await owner.get(`${prefix}/Order/${original.order.id}`)).status()).toBe(404);
        expect((await owner.get(`${prefix}/Admin/orders/${original.order.id}`)).status()).toBe(401);
      }
    }
    await confirmation(page, accepted.order);
    await confirmation(otherPage, otherOrder.order);
    expect((await post(staffContext.request, "Auth/logout", {})).status()).toBe(200);
    expect((await staffContext.request.get("/api/bff/Auth/me")).status()).toBe(401);
  } finally { await staffContext.close(); await independent.close(); }
});

test("an accepted order with an uncertain browser response recovers the receipt after reload without duplication", async ({ page, context, browser }) => {
  const staffContext = await browser.newContext({ baseURL: origin });
  try {
    await staffLogin(await staffContext.newPage());
    const initialCount = (await (await staffContext.request.get("/api/bff/Admin/orders")).json()).totalCount;
    await prepare(page, `recovery-${randomUUID()}@example.com`);
    let accepts = 0;
    let accepted: { order: OrderReceiptDto; key: string; payload: PlaceOrderRequest } | undefined;
    await page.route("**/api/bff/Order", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      accepts++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      accepted = { order: receipt(await response.json()), key: route.request().headers()["idempotency-key"], payload: route.request().postDataJSON() as PlaceOrderRequest };
      // Lose only the browser response after the real API transaction commits.
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Place order", exact: true }).click();
    await expect.poll(() => Boolean(accepted)).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: /checkout is not resolved/ })).toBeVisible();
    const saved = await page.evaluate(() => ({ values: Object.values(localStorage).join(" "), attempt: localStorage.getItem("electro.checkout.attempt.v1.live") }));
    expect(saved.values).not.toMatch(/Sample Guest Customer|123 Sample Road|@example\.com|01712345678/);
    expect(JSON.parse(saved.attempt!).idempotencyKey).toBe(accepted!.key);
    await page.reload();
    const recovered = page.waitForResponse((response) => response.url().endsWith(`/Order/attempt/${accepted!.key}`));
    await page.getByRole("button", { name: "Check for receipt", exact: true }).click();
    const response = await recovered;
    expect(response.status()).toBe(200);
    expect(receipt(await response.json())).toEqual(accepted!.order);
    await confirmation(page, accepted!.order);
    expect(accepts).toBe(1);
    expect(await page.evaluate((key) => localStorage.getItem(key), attemptStorageKey)).toBeNull();
    const replay = await post(context.request, "Order", accepted!.payload, accepted!.key);
    expect(replay.status()).toBe(200);
    expect(receipt(await replay.json())).toEqual(accepted!.order);
    expect((await (await staffContext.request.get("/api/bff/Admin/orders")).json()).totalCount).toBe(initialCount + 1);
    expect((await context.request.get(`/api/bff/Order/${accepted!.order.id}`)).status()).toBe(404);
  } finally { await staffContext.close(); }
});

test("concurrent distinct attempts from one protected guest accept exactly once", async ({ page, context, browser }) => {
  const staffContext = await browser.newContext({ baseURL: origin });
  try {
    await staffLogin(await staffContext.newPage());
    const initialCount = (await (await staffContext.request.get("/api/bff/Admin/orders")).json()).totalCount;
    const quote = await prepare(page, `race-${randomUUID()}@example.com`);
    const productId = quote.lines[0].productId;
    const stock = (await (await context.request.get(`/api/bff/Product/${productId}`)).json()).product.stock;
    const second = await post(context.request, "Checkout/quote", { items: [{ productId, quantity: 1 }] });
    expect(second.status()).toBe(200);
    const quotes = [quote.quoteId, (await second.json()).quoteId];
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.all(quotes.map((quoteId, index) => post(context.request, "Order", {
      quoteId, contact: { name: "Sample Concurrent Guest", email: "same-guest@example.com", phone: "01712345678" },
      deliveryAddress: { street: "123 Sample Road", area: "Sample Area", city: "Dhaka", district: "Dhaka" },
    }, keys[index])));
    expect(results.map((result) => result.status()).sort()).toEqual([200, 409]);
    const winner = results.findIndex((result) => result.status() === 200);
    const accepted = receipt(await results[winner].json());
    expect((await results[1 - winner].json()).code).toBe("GUEST_ORDER_LIMIT");
    const recovered = await context.request.get(`/api/bff/Order/attempt/${keys[winner]}`);
    expect(recovered.status()).toBe(200);
    expect(receipt(await recovered.json())).toEqual(accepted);
    expect((await context.request.get(`/api/bff/Order/attempt/${keys[1 - winner]}`)).status()).toBe(404);
    expect((await (await staffContext.request.get("/api/bff/Admin/orders")).json()).totalCount).toBe(initialCount + 1);
    expect((await (await context.request.get(`/api/bff/Product/${productId}`)).json()).product.stock).toBe(stock - 1);
  } finally { await staffContext.close(); }
});
