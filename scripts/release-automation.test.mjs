import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { join } from "node:path";
import os from "node:os";
import { evaluateNpmAudit, checkNugetAudit, readNugetAudit } from "./audit-gate.mjs";
import { captureNugetAudit } from "./capture-nuget-audit.mjs";
import { findCaseCollisions } from "./check-case-paths.mjs";
import { assertPortsAvailable, createE2eRunner } from "./run-e2e.mjs";
import { validateWorkflow } from "./validate-workflows.mjs";

const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
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
const nuget = () => ({
  version: 1, parameters: "--vulnerable --include-transitive", sources: ["https://api.nuget.org/v3/index.json"],
  projects: projects.map((name) => ({ path: `/home/runner/work/Electronics-Commerce/Electronics-Commerce/backend/${name.endsWith(".Tests") ? "tests" : "src"}/${name}/${name}.csproj` })),
});

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
test("NuGet version-1 clean project stubs pass with Linux and Windows paths", () => {
  const cleanReport = nuget();
  assert.equal(cleanReport.projects.every((project) => project.frameworks === undefined), true);
  checkNugetAudit(cleanReport);
  const windows = nuget();
  for (const project of windows.projects) project.path = project.path.replace("/home/runner/work", "C:/work").replaceAll("/", "\\");
  checkNugetAudit(windows);
  const emptyFrameworks = nuget();
  for (const project of emptyFrameworks.projects) project.frameworks = [{ framework: "net10.0", topLevelPackages: [], transitivePackages: [] }];
  checkNugetAudit(emptyFrameworks);
});
test("NuGet schema and required flags have specific fail-closed diagnostics", () => {
  for (const report of [null, [], {}, { ...nuget(), version: "1" }, { ...nuget(), version: 2 }]) {
    assert.throws(() => checkNugetAudit(report), /schema must be a version-1 JSON object/);
  }
  for (const parameters of [null, {}, "", "--vulnerable", "--include-transitive", "--vulnerable-extra --include-transitive", "--vulnerable --include-transitive-extra"]) {
    assert.throws(() => checkNugetAudit({ ...nuget(), parameters }), /parameters must include --vulnerable and --include-transitive/);
  }
});
test("NuGet coverage rejects missing duplicate and unexpected projects without exposing paths", () => {
  const missing = nuget(); missing.projects.pop();
  assert.throws(() => checkNugetAudit(missing), /missing required project: ElectroApi.Unit.Tests/);
  const missingCore = nuget(); missingCore.projects.splice(1, 1);
  assert.throws(() => checkNugetAudit(missingCore), /missing required project: ElectroApi.Core/);
  const duplicate = nuget(); duplicate.projects[1] = { ...duplicate.projects[0] };
  assert.throws(() => checkNugetAudit(duplicate), /duplicate project: ElectroApi.Api/);
  const extra = nuget(); extra.projects.push({ path: "/private-project-path/Unexpected.csproj" });
  assert.throws(() => checkNugetAudit(extra), (error) => {
    assert.match(error.message, /unexpected project/);
    assert.doesNotMatch(error.message, /private-project-path|Unexpected.csproj/);
    return true;
  });
});
test("NuGet warning and error logs and version-1 problems block at every scope", () => {
  for (const scope of ["report", "project", "framework"]) {
    for (const field of ["logs", "problems"]) {
      for (const level of ["warning", "error", "Warning", "Error"]) {
        const report = nuget();
        report.projects[0].frameworks = [{ framework: "net10.0" }];
        const container = scope === "report" ? report : scope === "project" ? report.projects[0] : report.projects[0].frameworks[0];
        container[field] = [{ level, [field === "problems" ? "text" : "message"]: "private-feed-diagnostic", project: "/private-project-path/Example.csproj" }];
        assert.throws(() => checkNugetAudit(report), (error) => {
          assert.match(error.message, new RegExp(`contains ${level.toLowerCase()} ${field}`));
          assert.doesNotMatch(error.message, /private-feed-diagnostic|private-project-path/);
          return true;
        });
      }
    }
  }
  const information = nuget(); information.logs = [{ level: "Information", message: "Audit finished." }];
  checkNugetAudit(information);
});
test("NuGet optional collections and nested entries reject malformed shapes", () => {
  const mutations = [
    (report) => { report.sources = {}; }, (report) => { report.sources = [null]; },
    (report) => { report.projects = {}; }, (report) => { report.projects[0] = null; },
    (report) => { report.projects[0].path = ""; },
    (report) => { report.logs = {}; }, (report) => { report.logs = [null]; },
    (report) => { report.logs = [{ level: "warning" }]; },
    (report) => { report.problems = null; }, (report) => { report.problems = [{}]; },
    (report) => { report.problems = [{ level: "information", text: "Not a version-1 problem level." }]; },
    (report) => { report.problems = [{ level: "warning", text: "Feed failed.", project: {} }]; },
    (report) => { report.projects[0].problems = {}; },
    (report) => { report.projects[0].frameworks = null; },
    (report) => { report.projects[0].frameworks = [null]; },
    (report) => { report.projects[0].frameworks = [{ framework: {} }]; },
    (report) => { report.projects[0].frameworks = [{ framework: "net10.0", problems: {} }]; },
    (report) => { report.projects[0].frameworks = [{ framework: "net10.0", topLevelPackages: {} }]; },
    (report) => { report.projects[0].frameworks = [{ framework: "net10.0", transitivePackages: [null] }]; },
    (report) => { report.projects[0].frameworks = [{ framework: "net10.0", topLevelPackages: [{ id: "Example", resolvedVersion: {} }] }]; },
  ];
  for (const mutate of mutations) {
    const report = nuget(); mutate(report);
    assert.throws(() => checkNugetAudit(report), /malformed|valid path/);
  }
});
test("NuGet top-level and transitive packages require evidence and every advisory blocks", () => {
  for (const field of ["topLevelPackages", "transitivePackages"]) {
    const report = nuget();
    const entry = { id: "Example.Package", resolvedVersion: "1.0.0", vulnerabilities: [] };
    report.projects[0].frameworks = [{ framework: "net10.0", [field]: [entry] }];
    checkNugetAudit(report);
    for (const vulnerabilities of [undefined, null, {}]) {
      entry.vulnerabilities = vulnerabilities;
      assert.throws(() => checkNugetAudit(report), /package vulnerability evidence is missing or malformed/);
    }
    for (const severity of ["Low", "Moderate", "High", "Critical"]) {
      entry.vulnerabilities = [{ severity, advisoryurl: "https://github.com/advisories/GHSA-xxxx-xxxx-xxxx" }];
      assert.throws(() => checkNugetAudit(report), /dependency advisories are not permitted/);
    }
  }
});
test("NuGet collector retains diagnostics and never promotes failed subprocess output", { timeout: 10000 }, async (t) => {
  const parent = process.platform === "win32" ? join(os.tmpdir(), "kilo") : os.tmpdir();
  await access(parent);
  const directory = await mkdtemp(join(parent, "electromart-nuget-collector-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stdout = `${JSON.stringify(nuget(), null, 2)}\n`;
  let collection;
  await t.test("import-safe collector uses bounded shell-free pinned arguments and retains successful output", async () => {
    const output = join(directory, "success");
    const report = await captureNugetAudit(output, { run: async (command, args, options) => {
      assert.equal(command, "dotnet");
      assert.deepEqual(args, ["list", "backend/ElectroApi.slnx", "package", "--vulnerable", "--include-transitive", "--format", "json", "--output-version", "1", "--no-restore"]);
      assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
      assert.equal(options.timeout, 120_000); assert.equal(options.killSignal, "SIGKILL");
      assert.equal(options.maxBuffer, 16 * 1024 * 1024); assert.equal(options.encoding, "utf8");
      assert.equal(options.cwd, fileURLToPath(new URL("../", import.meta.url)));
      return { stdout, stderr: "" };
    } });
    assert.deepEqual(report, nuget());
    assert.equal(await readFile(join(output, "nuget-audit.stdout.txt"), "utf8"), stdout);
    assert.equal(await readFile(join(output, "nuget-audit.stderr.txt"), "utf8"), "");
    assert.equal(await readFile(join(output, "nuget-audit.json"), "utf8"), stdout);
    collection = JSON.parse(await readFile(join(output, "nuget-audit-collection.json"), "utf8"));
    assert.equal(collection.status, "captured"); assert.equal(collection.exitCode, 0);
    assert.equal(collection.failure, null); assert.equal(collection.stdoutBytes, Buffer.byteLength(stdout));
    assert.deepEqual(await readNugetAudit(output), nuget());
  });
  await t.test("exit-zero version-1 warning and error problems are retained but cannot pass the gate", async () => {
    for (const level of ["warning", "error"]) {
      const output = join(directory, level);
      const report = nuget(); report.problems = [{ level, text: "private-feed-problem" }];
      const raw = JSON.stringify(report);
      await captureNugetAudit(output, { run: async () => ({ stdout: raw, stderr: "" }) });
      assert.equal(await readFile(join(output, "nuget-audit.stdout.txt"), "utf8"), raw);
      assert.equal(await readFile(join(output, "nuget-audit.json"), "utf8"), raw);
      await assert.rejects(readNugetAudit(output), new RegExp(`contains ${level} problems`));
    }
  });
  const failures = [
    { name: "nonzero exit with otherwise clean JSON", stdout, stderr: "private-exit-diagnostic", error: { code: 7 }, expected: { exitCode: 7, jsonParsed: true, timedOut: false }, message: /exited unsuccessfully/ },
    { name: "stderr warning on successful exit", stdout, stderr: "private-warning-diagnostic", expected: { exitCode: 0, jsonParsed: true, stderrPresent: true }, message: /wrote stderr/ },
    { name: "malformed JSON", stdout: "{private-invalid-json", stderr: "", expected: { exitCode: 0, jsonParsed: false }, message: /single JSON report/ },
    { name: "console text mixed with JSON", stdout: `private-restore-output\n${stdout}`, stderr: "", expected: { exitCode: 0, jsonParsed: false }, message: /single JSON report/ },
    { name: "valid JSON without report schema", stdout: "{}", stderr: "", expected: { exitCode: 0, jsonParsed: true }, message: /version-1 report/ },
    { name: "timeout retains partial clean JSON", stdout, stderr: "private-timeout-diagnostic", error: { code: null, killed: true, signal: "SIGKILL" }, expected: { exitCode: null, signal: "SIGKILL", jsonParsed: true, timedOut: true }, message: /timed out/ },
    { name: "executable missing", stdout: "", stderr: "private-exec-diagnostic", error: { code: "ENOENT" }, expected: { exitCode: null, errorCode: "ENOENT", jsonParsed: false, timedOut: false }, message: /could not execute or complete/ },
    { name: "stdout buffer limit", stdout, stderr: "", error: { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true, signal: "SIGKILL" }, expected: { errorCode: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", timedOut: false }, message: /could not execute or complete/ },
  ];
  for (const [index, fixture] of failures.entries()) {
    await t.test(fixture.name, async () => {
      const output = join(directory, `failure-${index}`);
      await mkdir(output);
      await writeFile(join(output, "nuget-audit.json"), stdout);
      await writeFile(join(output, "nuget-audit-collection.json"), JSON.stringify(collection));
      await assert.rejects(captureNugetAudit(output, { run: async () => {
        await assert.rejects(readNugetAudit(output), /collection did not complete successfully/);
        if (fixture.error) throw Object.assign(new Error("private-subprocess-message"), fixture.error, { stdout: fixture.stdout, stderr: fixture.stderr });
        return { stdout: fixture.stdout, stderr: fixture.stderr };
      } }), (error) => {
        assert.match(error.message, fixture.message); assert.doesNotMatch(error.message, /private-/);
        return true;
      });
      assert.equal(await readFile(join(output, "nuget-audit.stdout.txt"), "utf8"), fixture.stdout);
      assert.equal(await readFile(join(output, "nuget-audit.stderr.txt"), "utf8"), fixture.stderr);
      const diagnostics = JSON.parse(await readFile(join(output, "nuget-audit-collection.json"), "utf8"));
      assert.equal(diagnostics.status, "failed"); assert.match(diagnostics.failure, fixture.message);
      assert.equal(diagnostics.stdoutBytes, Buffer.byteLength(fixture.stdout));
      assert.equal(diagnostics.stderrBytes, Buffer.byteLength(fixture.stderr));
      for (const [key, value] of Object.entries(fixture.expected)) assert.equal(diagnostics[key], value);
      assert.doesNotMatch(JSON.stringify(diagnostics), /private-/);
      await assert.rejects(access(join(output, "nuget-audit.json")), { code: "ENOENT" });
      await assert.rejects(readNugetAudit(output), /collection did not complete successfully/);
      // Even externally restored clean stdout cannot override failed collection diagnostics.
      await writeFile(join(output, "nuget-audit.json"), stdout);
      await assert.rejects(readNugetAudit(output), /collection did not complete successfully/);
    });
  }
  await t.test("gate requires intact successful collection diagnostics and a single report document", async () => {
    const output = join(directory, "success");
    await rm(join(output, "nuget-audit-collection.json"));
    await assert.rejects(readNugetAudit(output), /collection diagnostics are missing or malformed/);
    for (const invalid of ["{", "null", JSON.stringify({}), JSON.stringify({ ...collection, jsonParsed: "true" }), JSON.stringify({ ...collection, signal: {} })]) {
      await writeFile(join(output, "nuget-audit-collection.json"), invalid);
      await assert.rejects(readNugetAudit(output), /collection diagnostics are .*malformed/);
    }
    for (const invalid of [{ ...collection, exitCode: 1 }, { ...collection, stderrPresent: true }, { ...collection, timedOut: true }]) {
      await writeFile(join(output, "nuget-audit-collection.json"), JSON.stringify(invalid));
      await assert.rejects(readNugetAudit(output), /collection did not complete successfully/);
    }
    await writeFile(join(output, "nuget-audit-collection.json"), JSON.stringify(collection));
    await writeFile(join(output, "nuget-audit.json"), `private-console-output\n${stdout}`);
    await assert.rejects(readNugetAudit(output), /not a single JSON document/);
  });
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
test("CI uses the NuGet collector before the always-run strict gate and evidence upload", async () => {
  const workflow = yaml.load(await readFile(new URL("../.github/workflows/commerce-ci.yml", import.meta.url), "utf8"));
  const steps = workflow.jobs.checks.steps;
  const capture = steps.findIndex((step) => step.name === "Capture NuGet Vulnerability Evidence");
  const gate = steps.findIndex((step) => step.name === "Gate Runtime And Full Dependency Audits");
  const upload = steps.findIndex((step) => step.name === "Upload Test, Coverage And Security Evidence");
  assert.equal(steps[capture].run, "node scripts/capture-nuget-audit.mjs");
  assert.equal(steps[gate].run, "node scripts/audit-gate.mjs");
  assert.ok(capture < gate && gate < upload);
  for (const index of [capture, gate, upload]) {
    assert.equal(steps[index].if, "always()");
    assert.equal(steps[index]["continue-on-error"], undefined);
  }
  const collector = await readFile(new URL("./capture-nuget-audit.mjs", import.meta.url), "utf8");
  assert.match(collector, /directory = join\(root, "artifacts\/security"\)/);
});

test("both CI jobs resolve the temporary .NET install directory only in their setup step", async () => {
  const workflow = yaml.load(await readFile(new URL("../.github/workflows/commerce-ci.yml", import.meta.url), "utf8"));
  validateWorkflow(workflow);
  for (const jobId of ["checks", "package"]) {
    const job = workflow.jobs[jobId];
    assert.equal(Object.hasOwn(job.env, "DOTNET_INSTALL_DIR"), false);
    const setup = job.steps.filter((step) => step.uses?.startsWith("actions/setup-dotnet@"));
    assert.equal(setup.length, 1);
    assert.equal(setup[0].env.DOTNET_INSTALL_DIR, "${{ runner.temp }}/commerce-dotnet");
    assert.equal(setup[0].with["dotnet-version"], "${{ env.DOTNET_VERSION }}");
    const invalid = structuredClone(workflow);
    invalid.jobs[jobId].env.DOTNET_INSTALL_DIR = setup[0].env.DOTNET_INSTALL_DIR;
    assert.throws(() => validateWorkflow(invalid), (error) => {
      assert.equal(error.message, `jobs.${jobId}.env cannot use the runner context; put runtime settings in step-level env.`);
      return true;
    });
  }
});

test("job environment validation rejects execution contexts but permits literals and nested properties", () => {
  const workflow = (value) => ({
    name: "Context validation fixture", on: "push", permissions: { contents: "read" },
    jobs: { checks: { "runs-on": "ubuntu-24.04", env: { DIRECTORY: value },
      steps: [{ run: "echo fixture", env: { DIRECTORY: "${{ runner.temp }}/fixture" } }] } },
  });
  for (const value of ["${{ runner['temp'] }}", "${{ RUNNER.temp }}", "${{ toJSON(runner) }}",
    "${{ format('{0}/fixture', runner.temp) }}", "${{ env.DIRECTORY }}", "${{ job.status }}", "${{ steps.setup.outputs.path }}"]) {
    assert.throws(() => validateWorkflow(workflow(value)), /cannot use the (runner|env|job|steps) context/);
  }
  for (const value of ["runner.temp", "${{ 'runner.temp' }}", "${{ format('it''s runner.temp', github.sha) }}",
    "${{ needs.runner.outputs.path }}", "${{ vars.DIRECTORY }}", "${{ github.workspace }}/fixture"]) {
    assert.doesNotThrow(() => validateWorkflow(workflow(value)));
  }
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
