import { spawn } from "node:child_process";
import { access, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const frontend = path.join(root, "frontend");
await access(root);
await access(path.join(frontend, ".next", "BUILD_ID"));
const standalone = path.join(frontend, ".next", "standalone");
await access(standalone);
await access(path.join(standalone, ".next"));
await cp(path.join(frontend, "public"), path.join(standalone, "public"), { recursive: true });
await cp(path.join(frontend, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
const mysql = process.env.ELECTROMART_TEST_MYSQL;
if (!mysql || process.env.ELECTROMART_TEST_SMTP !== "1") throw new Error("Explicit isolated MySQL 8.4 and SMTP capture readiness are required for E2E.");
const database = "electromart_test_" + randomUUID().replaceAll("-", "");
const connection = mysql.replace(/(?:^|;)\s*(?:database|initial catalog)\s*=[^;]*/gi, "") + ";Database=" + database + ";";
if (!/(?:server|host)\s*=\s*(?:localhost|127\.0\.0\.1|mysql)\s*;/i.test(connection)) throw new Error("E2E refuses nonlocal MySQL servers.");
const tls = Boolean(process.env.E2E_TLS_CERT && process.env.E2E_TLS_KEY);
const origin = tls ? "https://localhost:3443" : "http://localhost:3000";
const api = tls ? "https://localhost:7220" : "http://localhost:5249";
const keyPath = path.join(os.tmpdir(), "kilo", "electromart_e2e_keys_" + database);
const env = {
  ...process.env,
  ASPNETCORE_ENVIRONMENT: "Development",
  ConnectionStrings__DefaultConnection: connection,
  Storefront__Origin: origin,
  Security__KeyPath: keyPath,
  Security__DevelopmentHttps: String(tls),
  Mail__Host: "127.0.0.1", Mail__Port: "1025", Mail__EnableSsl: "false", Mail__Sender: "development@example.com",
  Logging__LogLevel__Default: "Warning", Logging__LogLevel__Microsoft: "Warning",
  STOREFRONT_MODE: "live", STOREFRONT_URL: origin, API_BASE_URL: api,
  NODE_USE_SYSTEM_CA: "1",
  NODE_OPTIONS: [process.env.NODE_OPTIONS, tls ? `--require="${path.join(root, "scripts", "e2e-ca.cjs").replaceAll("\\", "/")}"` : ""].filter(Boolean).join(" "),
  E2E_BASE_URL: origin,
  PORT: "3000", HOSTNAME: "127.0.0.1",
  Bootstrap__Email: "operator@example.com", Bootstrap__Password: "E2eOperator1!",
};
const processes = [];
const done = (child) => new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
function run(command, args, workdir = root) {
  const child = spawn(command, args, { cwd: workdir, env, stdio: "inherit", windowsHide: true });
  processes.push(child);
  child.on("error", () => console.error("An E2E subprocess could not start."));
  return child;
}
async function once(command, args, workdir) { const code = await done(run(command, args, workdir)); if (code) throw new Error("E2E prerequisite command failed."); }
async function ready(url) {
  let failure = "unknown";
  for (let attempt = 0; attempt < 120; attempt++) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (response.ok) return; failure = "HTTP " + response.status; } catch (error) { failure = error.cause?.code ?? error.name; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Local E2E service did not become ready (" + failure + ").");
}
let exitCode = 1;
try {
  await once("dotnet", ["run", "--project", "backend/src/ElectroApi.Api", "--no-build", "--no-launch-profile", "--", "--migrate-dev", "--seed-dev", "--bootstrap-admin"]);
  run("dotnet", ["run", "--project", "backend/src/ElectroApi.Api", "--no-build", "--no-launch-profile", "--urls", tls ? "http://localhost:5249;https://localhost:7220" : "http://localhost:5249"]);
  await ready("http://localhost:5249/health/database");
  // CI validates the same production output; no dev server or browser-only API fixture substitutes.
  run(process.execPath, ["server.js"], standalone);
  await ready("http://localhost:3000/products");
  if (tls) { run(process.execPath, ["scripts/tls-proxy.mjs"]); await ready(origin + "/products"); }
  const playwright = run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], frontend);
  exitCode = await done(playwright);
} finally {
  for (const child of processes.reverse()) {
    if (child.exitCode !== null || child.killed) continue;
    if (process.platform === "win32") {
      await new Promise((resolve) => { const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); killer.once("exit", resolve); killer.once("error", resolve); });
    } else child.kill("SIGTERM");
  }
  console.log("E2E used an isolated electromart_test_* schema; no production data was modified.");
}
process.exitCode = exitCode;
