import { defineConfig, devices } from "@playwright/test";

const extended = process.env.ELECTROMART_EXTENDED_FEATURES === "1";
const profile = extended ? "extended" : "guest-only";

export default defineConfig({
  testDir: "./e2e",
  testMatch: extended ? ["**/commerce.spec.ts", "**/recovery.spec.ts"] : "**/guest-only.spec.ts",
  outputDir: `./test-results/playwright-artifacts/${profile}`,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: `playwright-report/${profile}` }], ["junit", { outputFile: `test-results/playwright-${profile}.xml` }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    ignoreHTTPSErrors: false,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
