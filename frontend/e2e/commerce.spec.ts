import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const mailBase = "http://127.0.0.1:8025";
const password = "SampleCustomer1!";

async function mailLink(request: APIRequestContext, email: string, subject: string): Promise<string> {
  let link = "";
  await expect.poll(async () => {
    const response = await request.get(`${mailBase}/api/v1/messages`);
    if (!response.ok()) return false;
    const inbox = await response.json();
    const item = inbox.messages.find((message: { Subject: string; To: { Address: string }[] }) => message.Subject.includes(subject) && message.To.some((to) => to.Address === email));
    if (!item) return false;
    const message = await (await request.get(`${mailBase}/api/v1/message/${item.ID}`)).json();
    link = (message.Text as string).match(/https?:\/\/[^\s]+#(?:userId|claimId|capability)=[^\s]+/)?.[0] ?? "";
    return Boolean(link);
  }, { timeout: 25_000, message: "A sample email link should arrive through the local SMTP outbox." }).toBe(true);
  return link;
}

async function login(page: Page, email: string, secret = password) {
  await page.goto("/account/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}

async function fillDelivery(page: Page, email: string) {
  await page.getByLabel("Recipient name").fill("Sample Customer");
  const field = page.getByLabel("Email", { exact: true });
  if (await field.isEditable()) await field.fill(email);
  await page.getByLabel("Bangladesh mobile number").fill("01712345678");
  await page.getByLabel("District", { exact: true }).selectOption("Dhaka");
  await page.getByLabel("Street and house").fill("123 Sample Road");
  await page.getByLabel("Area", { exact: true }).fill("Sample Area");
  await page.getByLabel("City or town").fill("Dhaka");
  await page.getByLabel("Postcode (optional)").fill("1205");
}

async function purchase(page: Page, email: string) {
  await page.goto("/products/sample-usb-c-cable");
  await page.getByRole("button", { name: /add to cart/i }).first().click();
  await page.goto("/checkout");
  await fillDelivery(page, email);
  await page.getByRole("button", { name: "Check price and availability" }).click();
  await page.getByRole("checkbox", { name: /I reviewed this quote/ }).check();
  await page.getByRole("button", { name: "Place COD order" }).click();
  await expect(page).toHaveURL(/\/orders\/[a-f0-9-]{36}$/);
  return page.url().split("/").at(-1)!;
}

test("phone-first catalog filters, load-more, drawer keyboard and persisted cart", async ({ page }) => {
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: /products/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /load more/i })).toBeVisible();
  await page.getByRole("button", { name: /load more/i }).click();
  await expect(page.getByRole("link", { name: /Sample USB-C Cable/ }).first()).toBeVisible();
  await page.goto("/products?q=samsung+galaxy&brand=Samsung&stock=in");
  await expect(page.getByRole("link", { name: /Galaxy S24/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /MacBook/ })).toHaveCount(0);
  await page.goto("/products/sample-usb-c-cable");
  await page.getByRole("button", { name: /add to cart/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  const cartButton = page.getByRole("button", { name: /cart/i }).first();
  await cartButton.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.goto("/checkout");
  await expect(page.getByText("Sample USB-C Cable", { exact: false }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("guest COD persists private receipt, explicit email claim and password recovery", async ({ page, request, browser }, testInfo) => {
  const email = `sample-${testInfo.project.name}-${Date.now()}@example.com`;
  const id = await purchase(page, email);
  await page.reload();
  await expect(page.getByText(/Unpaid/).first()).toBeVisible();
  const privateLink = await mailLink(request, email, "COD order accepted");
  const separate = await browser.newContext({ baseURL: testInfo.project.use.baseURL ?? process.env.E2E_BASE_URL });
  const otherPage = await separate.newPage();
  await otherPage.goto(`/orders/${id}`);
  await expect(otherPage.getByText(/unavailable|private|access/i).first()).toBeVisible();
  await otherPage.goto(privateLink);
  await otherPage.getByRole("button", { name: "Unlock private order" }).click();
  await expect(otherPage).toHaveURL(new RegExp(`/orders/${id}$`));
  await expect(otherPage.getByText(/Unpaid/).first()).toBeVisible();

  await page.goto("/account/register");
  await page.getByLabel("Name", { exact: true }).fill("Sample Customer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Register and send verification" }).click();
  const verify = await mailLink(request, email, "Verify your");
  await page.goto(verify);
  await expect(page).toHaveURL(/\/account\/verify$/);
  await page.getByRole("button", { name: "Confirm verification" }).click();
  await expect(page.getByText("Email verified. Sign in to continue.")).toBeVisible();
  await login(page, email);
  await page.goto("/account/orders");
  await expect(page.getByText(/no orders|no account orders/i).first()).toBeVisible();
  await page.getByLabel(/order id/i).fill(id);
  await page.getByRole("button", { name: /request.*claim|send.*claim/i }).click();
  const claim = await mailLink(request, email, "Claim your");
  await page.goto(claim);
  await expect(page).toHaveURL(/\/account\/claim$/);
  await page.getByRole("button", { name: "Confirm claim" }).click();
  await expect(page).toHaveURL(new RegExp(`/account/orders/${id}$`));
  await otherPage.reload();
  await expect(otherPage.getByText(/unavailable|private|access/i).first()).toBeVisible();
  await separate.close();

  await page.goto("/account/forgot");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send password reset email" }).click();
  const reset = await mailLink(request, email, "Reset your");
  await page.goto(reset);
  await expect(page).toHaveURL(/\/account\/reset$/);
  await page.getByLabel("New password", { exact: true }).fill("NewSampleCustomer2!");
  await page.getByLabel("Confirm new password").fill("NewSampleCustomer2!");
  await page.getByRole("button", { name: "Confirm password reset" }).click();
  await expect(page.getByText("Password reset. Sign in with your new password.")).toBeVisible();
  await login(page, email, "NewSampleCustomer2!");
  await page.goto(`/account/orders/${id}`);
  await expect(page.getByText("Sample USB-C Cable", { exact: false }).first()).toBeVisible();
});

test("operator manages categories products stock fulfillment cancellation and full cash collection", async ({ page, browser }, testInfo) => {
  const email = `stafforder-${testInfo.project.name}-${Date.now()}@example.com`;
  const firstOrder = await purchase(page, email);
  const secondOrder = await purchase(page, email);
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  const staff = await context.newPage();
  await login(staff, "operator@example.com", "E2eOperator1!");
  const slug = `sample-category-${testInfo.project.name}-${Date.now()}`;
  await staff.goto("/admin/categories/new");
  await staff.getByLabel(/category name|^name$/i).fill("Sample Managed Category");
  await staff.getByLabel(/slug/i).fill(slug);
  await staff.getByLabel(/visual/i).selectOption("accessories");
  await staff.getByRole("button", { name: "Create category", exact: true }).click();
  await expect(staff).toHaveURL(/\/admin\/categories$/);
  await staff.goto("/admin/products/new");
  await staff.getByLabel("Product name").fill("Sample Managed Cable");
  await staff.getByLabel("Permanent URL slug").fill(`sample-product-${slug}`);
  await staff.getByLabel("Category", { exact: true }).selectOption({ label: "Sample Managed Category" });
  await staff.getByLabel("Sale price (BDT)", { exact: true }).fill("599");
  await staff.getByRole("button", { name: "Create product", exact: true }).click();
  await expect(staff).toHaveURL(/\/admin\/products\/[a-f0-9-]{36}$/);
  await staff.getByLabel("Quantity to adjust").fill("5");
  await staff.getByLabel("Reason for adjustment").fill("Sample received inventory");
  await staff.getByRole("button", { name: "Apply stock adjustment" }).click();
  await expect(staff.getByText(/Current available stock/)).toContainText("5");
  await staff.goto(`/admin/orders/${firstOrder}`);
  await staff.getByLabel("Action", { exact: true }).selectOption("cancel");
  await staff.getByLabel("Cancellation reason").fill("Sample cancelled before shipment");
  await staff.getByRole("checkbox", { name: /I reviewed order/ }).check();
  await staff.getByRole("button", { name: "Cancel before shipment" }).click();
  await expect(staff.getByText("Cancelled", { exact: true }).first()).toBeVisible();
  await staff.goto(`/admin/orders/${secondOrder}`);
  await staff.getByRole("checkbox", { name: /I reviewed order/ }).check();
  await staff.getByRole("button", { name: "Confirm order" }).click();
  await expect(staff.getByText("Confirmed", { exact: true }).first()).toBeVisible();
  await staff.getByRole("checkbox", { name: /I reviewed order/ }).check();
  await staff.getByRole("button", { name: "Mark shipped" }).click();
  await expect(staff.getByText("Shipped", { exact: true }).first()).toBeVisible();
  await staff.getByRole("checkbox", { name: /I reviewed order/ }).check();
  await staff.getByRole("button", { name: "Mark delivered" }).click();
  await expect(staff.getByText("Delivered", { exact: true }).first()).toBeVisible();
  await staff.getByRole("checkbox", { name: /full customer cash payment/ }).check();
  await staff.getByRole("button", { name: "Record customer cash received" }).click();
  await expect(staff.getByText("Collected", { exact: true }).first()).toBeVisible();
  await context.close();
});

test("same-origin BFF refuses forged management writes and arbitrary proxy paths", async ({ request }) => {
  const path = await request.get("/api/bff/https://attacker.example/anything");
  expect([400, 403, 404]).toContain(path.status());
  const forged = await request.post("/api/bff/Auth/login", { headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" }, data: { email: "operator@example.com", password: "E2eOperator1!" } });
  expect(forged.status()).toBe(403);
  const denied = await request.get("/api/bff/Admin/orders");
  expect(denied.status()).toBe(401);
});
