import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page) {
  await page.goto("/products/sample-usb-c-cable");
  await page.getByRole("button", { name: /add to cart/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goto("/checkout");
  await page.getByLabel("Recipient name").fill("Sample Recovery Customer");
  await page.getByLabel("Email", { exact: true }).fill(`recovery-${Date.now()}@example.com`);
  await page.getByLabel("Bangladesh mobile number").fill("01712345678");
  await page.getByLabel("District", { exact: true }).selectOption("Dhaka");
  await page.getByLabel("Street and house").fill("123 Sample Road");
  await page.getByLabel("Area", { exact: true }).fill("Sample Area");
  await page.getByLabel("City or town").fill("Dhaka");
  await page.getByRole("button", { name: "Check price and availability" }).click();
  await page.getByRole("checkbox", { name: /I reviewed this quote/ }).check();
}

test("accepted order with lost response recovers after reload without a second acceptance", async ({ page }) => {
  await prepare(page);
  let accepts = 0;
  let committed = false;
  await page.route("**/api/bff/Order", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    accepts++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    committed = true;
    // Inject only the lost browser response; the real API transaction already committed.
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Place order" }).click();
  await expect.poll(() => committed).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: /checkout is not resolved/ })).toBeVisible();
  const unsafeStorage = await page.evaluate(() => Object.values(localStorage).join(" "));
  expect(unsafeStorage).not.toMatch(/Sample Recovery Customer|123 Sample Road|@example\.com|01712345678/);
  await page.reload();
  await page.getByRole("button", { name: "Check for receipt" }).click();
  await expect(page).toHaveURL(/\/orders\/[a-f0-9-]{36}$/);
  expect(accepts).toBe(1);
  await expect(page.getByText("Unpaid", { exact: true })).toBeVisible();
  await expect(page.getByText("Order received. We will contact you to confirm the order and payment.")).toBeVisible();
});

test("session expiration never retries an account quote as a guest", async ({ page }) => {
  await page.goto("/account/login");
  await page.getByLabel("Email", { exact: true }).fill("operator@example.com");
  await page.getByLabel("Password", { exact: true }).fill("E2eOperator1!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/products/sample-usb-c-cable");
  await page.getByRole("button", { name: /add to cart/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goto("/checkout");
  await page.getByLabel("Recipient name").fill("Sample Session Customer");
  await page.getByLabel("Bangladesh mobile number").fill("01712345678");
  await page.getByLabel("District", { exact: true }).selectOption("Dhaka");
  await page.getByLabel("Street and house").fill("123 Sample Road");
  await page.getByLabel("Area", { exact: true }).fill("Sample Area");
  await page.getByLabel("City or town").fill("Dhaka");
  const cookies = await page.context().cookies();
  const auth = cookies.find((cookie) => cookie.name === "ElectroMart.Auth")!;
  await page.context().addCookies([{ ...auth, value: "expired-invalid-account-cookie" }]);
  let quotes = 0;
  page.on("request", (request) => { if (request.url().endsWith("/Checkout/quote")) quotes++; });
  await page.getByRole("button", { name: "Check price and availability" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Sign in again/ })).toBeVisible();
  expect(quotes).toBe(0);
  await page.context().clearCookies({ name: "ElectroMart.Auth" });
});

test("simultaneous cart additions in two tabs retain both user changes", async ({ page }) => {
  await page.goto("/products/sample-usb-c-cable");
  const other = await page.context().newPage();
  await other.goto("/products/sample-controller");
  await Promise.all([
    page.getByRole("button", { name: /add to cart/i }).first().click(),
    other.getByRole("button", { name: /add to cart/i }).first().click(),
  ]);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(other.getByRole("dialog")).toBeVisible();
  await page.goto("/checkout");
  await expect(page.getByRole("link", { name: "Sample USB-C Cable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sample Game Controller" })).toBeVisible();
  await other.close();
});
