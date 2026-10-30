import { spawn } from "node:child_process";
import { access, cp } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
class E2eError extends Error {}

export function disableOwnerNotifications(environment = process.env) {
  const inherited = Object.fromEntries(Object.entries(environment).filter(([key]) => !/^(OwnerNotifications|Telegram)(?:__|:)/i.test(key)));
  return { ...inherited, OwnerNotifications__Enabled: "false", Telegram__BotToken: "", Telegram__OwnerChatId: "" };
}

export function createE2eEnvironment(environment = process.env) {
  const extended = environment.ELECTROMART_EXTENDED_FEATURES === "1";
  const mysql = environment.ELECTROMART_TEST_MYSQL;
  if (!mysql) throw new E2eError("Explicit isolated local MySQL 8.4 is required for E2E.");
  if (extended && environment.ELECTROMART_TEST_SMTP !== "1") throw new E2eError("Extended E2E requires explicit local SMTP capture readiness.");
  const hosts = [...mysql.matchAll(/(?:^|;)\s*(?:server|host|data\s*source|address|addr|network\s*address)\s*=\s*([^;]*)/gi)];
  if (hosts.length !== 1 || !/^(?:localhost|127\.0\.0\.1|mysql)$/i.test(hosts[0][1].trim())) throw new E2eError("E2E refuses nonlocal or ambiguous MySQL servers.");
  const database = "electromart_test_" + randomUUID().replaceAll("-", "");
  const connection = mysql.replace(/(?:^|;)\s*(?:database|initial catalog)\s*=[^;]*/gi, "") + ";Database=" + database + ";";
  if (Boolean(environment.E2E_TLS_CERT) !== Boolean(environment.E2E_TLS_KEY)) throw new E2eError("Local E2E TLS requires both certificate and key.");
  const tls = Boolean(environment.E2E_TLS_CERT);
  const origin = tls ? "https://localhost:3443" : "http://localhost:3000";
  const api = tls ? "https://localhost:7220" : "http://localhost:5249";
  const inherited = Object.fromEntries(Object.entries(disableOwnerNotifications(environment)).filter(([key]) =>
    !/^(Mail(?:__|:)|Commerce(?:__|:)(?:GuestOnly|CheckoutEnabled)$|ConnectionStrings(?:__|:)DefaultConnection$|STOREFRONT_GUEST_ONLY$|ELECTROMART_EXTENDED_FEATURES$|ELECTROMART_TEST_(?:MYSQL|SMTP)$)/i.test(key)));
  return {
    ...inherited,
    ASPNETCORE_ENVIRONMENT: "Development", DOTNET_ENVIRONMENT: "Development", NODE_ENV: "production",
    ConnectionStrings__DefaultConnection: connection,
    Storefront__Origin: origin,
    Security__KeyPath: path.join(os.tmpdir(), "kilo", "electromart_e2e_keys_" + database),
    Security__DevelopmentHttps: String(tls), Commerce__CheckoutEnabled: "true", Commerce__GuestOnly: String(!extended),
    Mail__Enabled: String(extended),
    ...(extended ? {
      ELECTROMART_TEST_SMTP: "1", Mail__Host: "127.0.0.1", Mail__Port: "1025", Mail__EnableSsl: "false",
      Mail__Sender: "development@example.com", Mail__Username: "", Mail__Password: "",
    } : {}),
    Logging__LogLevel__Default: "Warning", Logging__LogLevel__Microsoft: "Warning",
    "Logging__LogLevel__Microsoft.Hosting.Lifetime": "Information",
    STOREFRONT_MODE: "live", STOREFRONT_GUEST_ONLY: String(!extended), STOREFRONT_URL: origin, API_BASE_URL: api,
    ELECTROMART_EXTENDED_FEATURES: extended ? "1" : "0",
    NODE_USE_SYSTEM_CA: "1",
    NODE_OPTIONS: [environment.NODE_OPTIONS, tls ? `--require="${path.join(root, "scripts", "e2e-ca.cjs").replaceAll("\\", "/")}"` : ""].filter(Boolean).join(" "),
    E2E_BASE_URL: origin, E2E_TLS_PORT: "3443", E2E_HTTP_PORT: "3000",
    PORT: "3000", HOSTNAME: "127.0.0.1",
    Bootstrap__Email: "operator@example.com", Bootstrap__Password: "E2eOperator1!",
  };
}

export async function assertPortsAvailable(ports = [3000, 3443, 5249, 7220]) {
  const reservations = [];
  try {
    for (const port of ports) {
      for (const host of ["127.0.0.1", "::1"]) {
        await new Promise((resolve, reject) => {
          const socket = createConnection({ port, host });
          const timer = setTimeout(() => {
            socket.destroy();
            reject(new E2eError("E2E local port checks timed out."));
          }, 2000);
          socket.once("connect", () => {
            clearTimeout(timer);
            socket.destroy();
            reject(new E2eError("E2E requires unused local service ports; stop existing listeners first."));
          });
          socket.once("error", (error) => {
            clearTimeout(timer);
            socket.destroy();
            if (error.code === "ECONNREFUSED" || (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL", "ENETUNREACH"].includes(error.code))) resolve();
            else reject(new E2eError("E2E local port availability could not be verified."));
          });
        });
        const server = createServer((socket) => socket.destroy());
        reservations.push(server);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new E2eError("E2E local port checks timed out.")), 2000);
          server.once("listening", () => { clearTimeout(timer); resolve(); });
          server.once("error", (error) => {
            clearTimeout(timer);
            if (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) resolve();
            else reject(new E2eError("E2E requires unused local service ports; stop existing listeners first."));
          });
          server.listen({ port, host, exclusive: true });
        });
      }
    }
  } finally {
    await Promise.all(reservations.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

export function createE2eRunner(env = process.env) {
  const processes = [];
  const controller = new AbortController();
  let stopping = false;
  function bounded(operation, signal, message) {
    return new Promise((resolve, reject) => {
      const abort = () => reject(new E2eError(message));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  function scope(timeoutMs) {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    return { signal: AbortSignal.any([controller.signal, deadline.signal]), dispose: () => clearTimeout(timer) };
  }
  function live(entry) {
    if (controller.signal.aborted || entry.finished || entry.child.exitCode !== null || entry.child.signalCode !== null) {
      throw new E2eError("An owned E2E service stopped or could not start.");
    }
  }
  function run(command, args, { cwd = root, readyPattern, service = false, inheritOutput = false } = {}) {
    let child;
    try {
      child = spawn(command, args, { cwd, env, stdio: inheritOutput ? "inherit" : ["ignore", "pipe", "pipe"],
        windowsHide: true, detached: process.platform !== "win32" });
    } catch { throw new E2eError("An E2E subprocess could not start."); }
    const entry = { child, finished: false, ready: false };
    entry.done = new Promise((resolve) => {
      const settle = (code) => {
        if (entry.finished) return;
        entry.finished = true;
        if (process.platform !== "win32" && child.pid) {
          try { process.kill(-child.pid, "SIGKILL"); } catch { }
        }
        if (service && !stopping) controller.abort();
        resolve(code);
      };
      child.once("error", () => settle(1));
      child.once("exit", (code) => settle(code ?? 1));
    });
    // Drain but never relay service output: connection failures may include sensitive settings.
    let output = "";
    child.stdout?.on("data", (chunk) => {
      if (readyPattern && !entry.ready) {
        output = (output + chunk.toString()).slice(-8192);
        entry.ready = readyPattern.test(output);
        if (entry.ready) output = "";
      }
    });
    child.stderr?.resume();
    processes.push(entry);
    return entry;
  }
  async function wait(entry, timeoutMs = 300000) {
    const deadline = scope(timeoutMs);
    try {
      const code = await bounded(entry.done, deadline.signal, "E2E command timed out, was interrupted, or lost an owned service.");
      if (code !== 0) throw new E2eError("An E2E subprocess failed; its potentially sensitive output was suppressed.");
      return code;
    } finally { deadline.dispose(); }
  }
  async function ready(entry, url, { timeoutMs = 60000, pollMs = 100, fetchService = fetch } = {}) {
    const deadline = scope(timeoutMs);
    try {
      while (true) {
        live(entry);
        let ok = false;
        if (entry.ready) {
          const request = AbortSignal.any([deadline.signal, AbortSignal.timeout(2000)]);
          try {
            const response = await bounded(fetchService(url, { signal: request, redirect: "error" }), request, "Local E2E readiness timed out.");
            ok = response.ok;
            response.body?.cancel().catch(() => {});
          } catch {
            if (deadline.signal.aborted) throw new E2eError("Local E2E readiness timed out or lost an owned service.");
          }
          live(entry);
          if (ok) return;
        }
        await bounded(delay(pollMs, undefined, { signal: deadline.signal }), deadline.signal, "Local E2E readiness timed out or lost an owned service.");
      }
    } finally { deadline.dispose(); }
  }
  async function cleanup() {
    stopping = true;
    controller.abort();
    const stopped = await Promise.all([...processes].reverse().map(async (entry) => {
      if (entry.finished || !entry.child.pid) return true;
      const settle = async (promise, milliseconds) => {
        let timer;
        try { return await Promise.race([promise.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
        finally { clearTimeout(timer); }
      };
      if (process.platform === "win32") {
        if (!entry.finished) {
          let killer;
          try {
            killer = spawn("taskkill", ["/PID", String(entry.child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
            const done = new Promise((resolve) => { killer.once("exit", resolve); killer.once("error", resolve); });
            if (!await settle(done, 3000)) killer.kill();
          } catch { /* Direct-process termination below is the bounded fallback. */ }
          if (!entry.finished) entry.child.kill("SIGKILL");
        }
      } else {
        try { process.kill(-entry.child.pid, "SIGTERM"); } catch { }
        if (!entry.finished) await settle(entry.done, 1000);
        // Kill the owned process group even if its leader exited, so descendants cannot leak.
        try { process.kill(-entry.child.pid, "SIGKILL"); } catch { }
      }
      const complete = entry.finished || await settle(entry.done, 2000);
      if (!complete) {
        entry.child.stdout?.destroy();
        entry.child.stderr?.destroy();
        entry.child.unref();
      }
      return complete;
    }));
    if (stopped.includes(false)) throw new E2eError("An owned E2E process could not be stopped; verify local process state.");
  }
  return { run, wait, ready, cleanup, cancel: () => controller.abort() };
}

async function main() {
  const frontend = path.join(root, "frontend");
  const project = path.join(root, "backend", "src", "ElectroApi.Api");
  const assembly = path.join(project, "bin", "Debug", "net10.0", "ElectroApi.Api.dll");
  const standalone = path.join(frontend, ".next", "standalone");
  let runner;
  const interrupt = () => runner?.cancel();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const env = createE2eEnvironment();
    const tls = env.Security__DevelopmentHttps === "true";
    const origin = env.STOREFRONT_URL;
    const api = env.API_BASE_URL;
    runner = createE2eRunner(env);
    await access(root);
    await access(assembly);
    await access(path.join(frontend, ".next", "BUILD_ID"));
    await access(path.join(standalone, "server.js"));
    await access(path.join(standalone, ".next"));
    await assertPortsAvailable();
    await cp(path.join(frontend, "public"), path.join(standalone, "public"), { recursive: true });
    await cp(path.join(frontend, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
    // Launch the existing Debug assembly directly, without build commands or an orphanable dotnet-run wrapper.
    await runner.wait(runner.run("dotnet", [assembly, "--migrate-dev", "--seed-dev", "--bootstrap-admin"], { cwd: project }));
    await assertPortsAvailable();
    const backend = runner.run("dotnet", [assembly, "--urls", tls ? "http://localhost:5249;https://localhost:7220" : "http://localhost:5249"], {
      cwd: project, service: true, readyPattern: /Now listening on:\s+http:\/\/localhost:5249/,
    });
    await runner.ready(backend, "http://127.0.0.1:5249/health/database");
    if (tls) await runner.ready(backend, api + "/health/database");
    // CI validates the actual production output, never a dev server or browser-only API fixture.
    const storefront = runner.run(process.execPath, ["server.js"], { cwd: standalone, service: true, readyPattern: /Ready in\s/ });
    await runner.ready(storefront, "http://127.0.0.1:3000/products");
    if (tls) {
      const proxy = runner.run(process.execPath, ["scripts/tls-proxy.mjs"], { service: true, readyPattern: /Local TLS proxy ready\./ });
      await runner.ready(proxy, origin + "/products");
    }
    await runner.wait(runner.run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], {
      cwd: frontend, inheritOutput: true,
    }), 1200000);
    process.exitCode = 0;
  } catch (error) {
    console.error(error instanceof E2eError ? error.message : "E2E prerequisites could not be validated; no release validation was accepted.");
    process.exitCode = 1;
  } finally {
    try { await runner?.cleanup(); }
    catch { console.error("E2E cleanup failed; verify local process state before rerunning."); process.exitCode = 1; }
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
