import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import os from "node:os";
import { evaluateNpmAudit, checkNugetAudit } from "./audit-gate.mjs";
import { findCaseCollisions } from "./check-case-paths.mjs";
import { assertPortsAvailable, createE2eRunner } from "./run-e2e.mjs";

const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
const clean = () => ({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { ...counts } } });
const finding = () => ({
  auditReportVersion: 2,
  vulnerabilities: {
    braces: { name: "braces", severity: "high", isDirect: false, range: "<=3.0.3", nodes: ["node_modules/braces"], via: [{ source: 1240992, dependency: "braces", severity: "high", range: "<=3.0.3", url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm" }] },
  },
  metadata: { vulnerabilities: { ...counts, high: 1, total: 1 } },
});
const projects = ["ElectroApi.Api", "ElectroApi.Core", "ElectroApi.Infrastructure", "ElectroApi.Integration.Tests", "ElectroApi.Unit.Tests"];
const nuget = () => ({ version: 1, parameters: "--vulnerable --include-transitive", projects: projects.map((name) => ({ path: `/sample/${name}.csproj`, frameworks: [{ framework: "net10.0" }] })) });

test("clean npm graph passes and every development finding still blocks release", () => {
  assert.equal(evaluateNpmAudit(clean(), clean()).status, "passed");
  const failed = evaluateNpmAudit(clean(), finding());
  assert.equal(failed.status, "failed"); assert.equal(failed.fullVulnerabilityCount, 1);
  assert.match(failed.failures[0], /GHSA-vfj7-8cjw-p6xm/);
  assert.equal(evaluateNpmAudit(finding(), finding()).runtimeVulnerabilityCount, 1);
});
test("missing inconsistent cyclic and unrecognized npm reports fail closed", () => {
  assert.throws(() => evaluateNpmAudit({}, clean()));
  const inconsistent = finding(); inconsistent.metadata.vulnerabilities.total = 0;
  assert.throws(() => evaluateNpmAudit(clean(), inconsistent));
  const cyclic = finding(); cyclic.vulnerabilities.braces.via = ["braces"];
  assert.throws(() => evaluateNpmAudit(clean(), cyclic), /cyclic/);
  const unknown = finding(); unknown.vulnerabilities.braces.via[0].url = "https://attacker.example/advisory";
  assert.throws(() => evaluateNpmAudit(clean(), unknown), /identifier/);
});
test("NuGet graph must cover all five canonical projects with transitive audit", () => {
  checkNugetAudit(nuget());
  const missing = nuget(); missing.projects.pop(); assert.throws(() => checkNugetAudit(missing));
  const error = nuget(); error.logs = [{ level: "warning" }]; assert.throws(() => checkNugetAudit(error));
  const vulnerable = nuget(); vulnerable.projects[0].frameworks[0].topLevelPackages = [{ vulnerabilities: [{ severity: "high" }] }];
  assert.throws(() => checkNugetAudit(vulnerable), /advisories/);
});
test("index collision check detects duplicate files and mixed-case directories", () => {
  assert.deepEqual(findCaseCollisions(["backend/src/ElectroApi.Api/Program.cs", "backend/src/ElectroApi.Core/Product.cs"]), []);
  assert.equal(findCaseCollisions(["src/Foo/a.cs", "src/foo/b.cs"]).length, 1);
  assert.equal(findCaseCollisions(["src/Foo.cs", "src/foo.cs"]).length, 1);
});
test("promotion cannot bypass security or perform migration or untrusted TLS deployment", async () => {
  const script = await readFile(new URL("./promote-iis.ps1", import.meta.url), "utf8");
  assert.match(script, /fullVulnerabilityCount -ne 0/);
  assert.match(script, /conclusion -ne 'success'/);
  assert.match(script, /default-branch push/);
  assert.doesNotMatch(script, /-allowUntrusted|-verbose|migrations database update|database update/);
  assert.ok(script.indexOf("Join-Path $download 'frontend'") < script.indexOf("recycleMode=StartAppPool"));
});
test("CI requires actual browser tests, strict audit and framework-dependent Windows artifacts", async () => {
  const workflow = await readFile(new URL("../.github/workflows/commerce-ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /npm run test:e2e/);
  assert.match(workflow, /node scripts\/audit-gate.mjs/);
  assert.match(workflow, /UseAppHost=false/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|allowUntrusted/);
  assert.match(workflow, /frontend\/test-results\/\*\*/);
});

test("occupied local ports fail closed without stopping the unrelated listener", { timeout: 5000 }, async () => {
  const listener = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, resolve); });
  const port = listener.address().port;
  try {
    await assert.rejects(assertPortsAvailable([port]), /requires unused local service ports/);
    assert.equal(listener.listening, true);
  } finally { await new Promise((resolve) => listener.close(resolve)); }
  await assertPortsAvailable([port]);
  await assertPortsAvailable([port]);
});

test("spawn failures and nonzero subprocess exits settle without exposing diagnostics", { timeout: 6000 }, async (t) => {
  const runner = createE2eRunner();
  t.after(() => runner.cleanup());
  const missing = runner.run(join(os.tmpdir(), "kilo", "missing-e2e-secret-command"), []);
  await assert.rejects(runner.wait(missing, 2000), (error) => {
    assert.equal(error.message, "An E2E subprocess failed; its potentially sensitive output was suppressed.");
    return true;
  });
  const failure = runner.run(process.execPath, ["-e", "console.error('private-connection-detail'); process.exit(7);"]);
  await assert.rejects(runner.wait(failure, 2000), (error) => {
    assert.doesNotMatch(error.message, /private-connection|missing-e2e-secret/);
    assert.match(error.message, /output was suppressed/);
    return true;
  });
});

test("command timeouts stop the owned process and repeated cleanup is safe", { timeout: 6000 }, async (t) => {
  const runner = createE2eRunner();
  t.after(() => runner.cleanup());
  const child = runner.run(process.execPath, ["-e", "setInterval(() => {}, 1000);"]);
  await assert.rejects(runner.wait(child, 100), /timed out/);
  await runner.cleanup();
  assert.equal(child.finished, true);
  await runner.cleanup();
});

test("HTTP success cannot replace a startup marker from the owned service", { timeout: 6000 }, async (t) => {
  const runner = createE2eRunner();
  t.after(() => runner.cleanup());
  const service = runner.run(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { service: true, readyPattern: /UNIT_READY/ });
  let requests = 0;
  await assert.rejects(runner.ready(service, "http://127.0.0.1/unit", {
    timeoutMs: 150, fetchService: async () => { requests += 1; return { ok: true }; },
  }), /timed out/);
  assert.equal(requests, 0);
});

test("service death rejects readiness even if an unrelated HTTP response is successful", { timeout: 6000 }, async (t) => {
  const runner = createE2eRunner();
  t.after(() => runner.cleanup());
  const service = runner.run(process.execPath, ["-e", "console.log('UNIT_READY'); setInterval(() => {}, 1000);"], { service: true, readyPattern: /UNIT_READY/ });
  let requested = false;
  await assert.rejects(runner.ready(service, "http://127.0.0.1/unit", {
    timeoutMs: 3000,
    fetchService: async () => {
      requested = true;
      service.child.kill();
      await service.done;
      return { ok: true };
    },
  }), /owned.*service/);
  assert.equal(requested, true);
});

test("readiness has a wall deadline even for a fetch that ignores cancellation", { timeout: 6000 }, async (t) => {
  const runner = createE2eRunner();
  t.after(() => runner.cleanup());
  const service = runner.run(process.execPath, ["-e", "console.log('UNIT_READY'); setInterval(() => {}, 1000);"], { service: true, readyPattern: /UNIT_READY/ });
  await runner.ready(service, "http://127.0.0.1/unit", { timeoutMs: 3000, fetchService: async () => ({ ok: true }) });
  const started = performance.now();
  await assert.rejects(runner.ready(service, "http://127.0.0.1/unit", {
    timeoutMs: 100, fetchService: () => new Promise(() => {}),
  }), /timed out/);
  assert.ok(performance.now() - started < 1500);
});

test("a service exit after readiness interrupts another owned command", { timeout: 6000 }, async (t) => {
  const runner = createE2eRunner();
  t.after(() => runner.cleanup());
  const service = runner.run(process.execPath, ["-e", "console.log('UNIT_READY'); setInterval(() => {}, 1000);"], { service: true, readyPattern: /UNIT_READY/ });
  await runner.ready(service, "http://127.0.0.1/unit", { timeoutMs: 3000, fetchService: async () => ({ ok: true }) });
  const command = runner.run(process.execPath, ["-e", "setInterval(() => {}, 1000);"]);
  service.child.kill();
  await assert.rejects(runner.wait(command, 3000), /lost an owned service/);
  await runner.cleanup();
  assert.equal(command.finished, true);
});

test("IIS package checkout guard executes and accepts only an explicit false JSON boolean", { timeout: 15000 }, async (t) => {
  const parent = process.platform === "win32" ? join(os.tmpdir(), "kilo") : os.tmpdir();
  await access(parent);
  const directory = await mkdtemp(join(parent, "electromart-release-guard-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cases = [
    ["paused", '{"Commerce":{"CheckoutEnabled":false}}'],
    ["enabled", '{"Commerce":{"CheckoutEnabled":true},"Mail":{"Password":"private-fixture-value"}}'],
    ["string", '{"Commerce":{"CheckoutEnabled":"false"}}'],
    ["zero", '{"Commerce":{"CheckoutEnabled":0}}'],
    ["null", '{"Commerce":{"CheckoutEnabled":null}}'],
    ["missing-flag", '{"Commerce":{}}'],
    ["missing-section", '{}'],
    ["null-section", '{"Commerce":null}'],
    ["malformed", '{"Commerce": private-fixture-value'],
  ];
  await Promise.all(cases.map(([name, contents]) => writeFile(join(directory, `${name}.json`), contents)));
  const script = fileURLToPath(new URL("./package-iis.ps1", import.meta.url));
  const source = await readFile(script, "utf8");
  assert.match(source, /Assert-CheckoutPaused \(Join-Path \$Path 'backend\/appsettings\.json'\)/);
  assert.match(source, /Assert-CheckoutPaused \(Join-Path \$backend 'appsettings\.json'\)/);
  const command = `
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:RELEASE_TEST_SCRIPT, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'Package guard script did not parse.' }
    $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-CheckoutPaused' }, $true)
    if ($null -eq $function) { throw 'Package checkout guard is missing.' }
    . ([scriptblock]::Create($function.Extent.Text))
    foreach ($name in @('paused', 'enabled', 'string', 'zero', 'null', 'missing-flag', 'missing-section', 'null-section', 'malformed', 'missing-file')) {
      $accepted = $false
      try { Assert-CheckoutPaused (Join-Path $env:RELEASE_TEST_DIRECTORY ($name + '.json')); $accepted = $true }
      catch {
        if ($_.Exception.Message -cne 'Packaged API must explicitly set Commerce.CheckoutEnabled to the JSON boolean false.') { throw 'Package guard leaked an unsafe diagnostic.' }
      }
      if ($accepted -ne ($name -eq 'paused')) { throw 'Package checkout guard accepted an unsafe setting or refused false.' }
    }
    'Checkout package guard passed 10 cases.'
  `;
  const { stdout, stderr } = await promisify(execFile)("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    env: { ...process.env, RELEASE_TEST_SCRIPT: script, RELEASE_TEST_DIRECTORY: directory }, timeout: 12000,
  });
  assert.equal(stdout.trim(), "Checkout package guard passed 10 cases.");
  assert.equal(stderr, "");
});
