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
import { assertPortsAvailable, createE2eEnvironment, createE2eRunner, disableOwnerNotifications } from "./run-e2e.mjs";
import { validateWorkflow } from "./validate-workflows.mjs";
import { verifyEfTool } from "./verify-ef-tool.mjs";

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

test("EF verification accepts pinned single-line, LF and CRLF output with bounded shell-free execution", async () => {
  const manifest = JSON.parse(await readFile(new URL("../.config/dotnet-tools.json", import.meta.url), "utf8"));
  const version = manifest.tools["dotnet-ef"].version;
  const banner = "Entity Framework Core .NET Command-line Tools";
  for (const stdout of [`${banner} ${version}`, `${banner}\n${version}\n`, `${banner}\r\n${version}\r\n`]) {
    assert.equal(await verifyEfTool({ run: async (command, args, options) => {
      assert.equal(command, "dotnet");
      assert.deepEqual(args, ["ef", "--version"]);
      assert.equal(options.cwd, fileURLToPath(new URL("../", import.meta.url)));
      assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
      assert.equal(options.encoding, "utf8"); assert.equal(options.timeout, 30_000);
      assert.equal(options.killSignal, "SIGKILL"); assert.equal(options.maxBuffer, 64 * 1024);
      return { stdout, stderr: "" };
    } }), version);
  }
});
test("EF verification rejects wrong versions, incomplete output, stderr and unsuccessful commands", async () => {
  const manifest = JSON.parse(await readFile(new URL("../.config/dotnet-tools.json", import.meta.url), "utf8"));
  const stdout = `Entity Framework Core .NET Command-line Tools\n${manifest.tools["dotnet-ef"].version}\n`;
  for (const result of [
    { stdout: "Entity Framework Core .NET Command-line Tools\n0.0.0\n", stderr: "" },
    { stdout: "", stderr: "" }, { stdout: `${stdout}private-extra-output`, stderr: "" },
    { stdout, stderr: "private-warning" }, { stdout }, { stdout: null, stderr: "" },
  ]) {
    await assert.rejects(verifyEfTool({ run: async () => result }), (error) => {
      assert.match(error.message, /Expected EF CLI|incomplete output or stderr/);
      assert.doesNotMatch(error.message, /private-/);
      return true;
    });
  }
  for (const code of [1, "ENOENT", "ETIMEDOUT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"]) {
    await assert.rejects(verifyEfTool({ run: async () => {
      throw Object.assign(new Error("private-subprocess-error"), { code, stdout, stderr: "" });
    } }), /EF CLI version command failed/);
  }
});
test("both CI jobs verify the restored EF tool without comparing banner layout", async () => {
  const workflow = yaml.load(await readFile(new URL("../.github/workflows/commerce-ci.yml", import.meta.url), "utf8"));
  for (const jobId of ["checks", "package"]) {
    const step = workflow.jobs[jobId].steps.find((step) => step.run?.includes("dotnet tool restore"));
    assert.ok(step);
    assert.ok(step.run.indexOf("dotnet tool restore") < step.run.indexOf("node scripts/verify-ef-tool.mjs"));
    assert.doesNotMatch(step.run, /Entity Framework Core|dotnet ef --version/);
  }
});
test("CI installs pinned npm and tests the locked Next adapter on both platforms", async () => {
  const workflow = yaml.load(await readFile(new URL("../.github/workflows/commerce-ci.yml", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../frontend/package.json", import.meta.url), "utf8"));
  assert.equal(manifest.engines.npm, "12.x");
  assert.match(workflow.env.NPM_VERSION, /^12\.\d+\.\d+$/);
  for (const jobId of ["checks", "package"]) {
    const steps = workflow.jobs[jobId].steps;
    const npmSetup = steps.findIndex((step) => step.run === "npm install --global npm@${{ env.NPM_VERSION }}");
    const install = steps.findIndex((step) => step.run === "npm ci");
    const regression = steps.findIndex((step) => step.run?.startsWith("node --test ") && step.run.includes("scripts/next-eslint-glob.test.mjs"));
    assert.ok(npmSetup >= 0 && npmSetup < install && install < regression);
    assert.equal(steps[regression]["continue-on-error"], undefined);
  }
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
test("CI runs reduced E2E without SMTP before optional local capture and the extended regression profile", async () => {
  const workflow = yaml.load(await readFile(new URL("../.github/workflows/commerce-ci.yml", import.meta.url), "utf8"));
  const job = workflow.jobs.checks;
  assert.deepEqual(Object.keys(job.services), ["mysql"]);
  assert.equal(job.env.ELECTROMART_TEST_SMTP, undefined);
  assert.equal(job.env.STOREFRONT_GUEST_ONLY, "true");
  const steps = job.steps;
  const reduced = steps.findIndex((step) => step.name === "Guest-Only Production Stack E2E");
  const capture = steps.findIndex((step) => step.name === "Start Optional Local SMTP Capture");
  const smtp = steps.findIndex((step) => step.name === "Test Explicit SMTP Capture Integration");
  const extended = steps.findIndex((step) => step.name === "Extended Production Stack E2E");
  const cleanup = steps.findIndex((step) => step.name === "Stop Optional Local SMTP Capture");
  assert.ok(reduced >= 0 && reduced < capture && capture < smtp && smtp < extended && extended < cleanup);
  assert.equal(steps[reduced].run, "npm run test:e2e");
  assert.deepEqual(steps[reduced].env, { ELECTROMART_EXTENDED_FEATURES: "0", ELECTROMART_TEST_SMTP: "0" });
  assert.equal(steps[extended].run, "npm run test:e2e");
  assert.equal(steps[extended].env.ELECTROMART_EXTENDED_FEATURES, "1");
  assert.equal(steps[extended].env.ELECTROMART_TEST_SMTP, "1");
  assert.match(steps[capture].run, /127\.0\.0\.1:1025:1025/);
  assert.match(steps[capture].run, /127\.0\.0\.1:8025:8025/);
  assert.match(steps[capture].run, /axllent\/mailpit:v1\.29\.0/);
  assert.doesNotMatch(steps[capture].run, /SMTP_RELAY|TELEGRAM|BotToken|OwnerChatId/i);
  const backend = steps.find((step) => step.name === "Test Backend Against MySQL Without SMTP");
  assert.match(backend.run, /FullyQualifiedName!~Protected_outbox_delivers_through_real_local_SMTP_capture_and_scrubs_sent_payload/);
  assert.match(steps[smtp].run, /FullyQualifiedName~Protected_outbox_delivers_through_real_local_SMTP_capture_and_scrubs_sent_payload/);
  assert.equal(steps[smtp].env.ELECTROMART_TEST_SMTP, "1");
  assert.equal(steps[cleanup].if, "always()");
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

test("ordinary E2E removes inherited owner-alert secrets and disables real sending regardless of environment key case", () => {
  const source = {
    PATH: "sample-tools", ELECTROMART_TEST_MYSQL: "sample-local-connection",
    OwnerNotifications__Enabled: "true", OWNERNOTIFICATIONS__ENABLED: "true",
    Telegram__BotToken: "synthetic-secret", TELEGRAM__BOTTOKEN: "synthetic-secret-uppercase",
    telegram__OwnerChatId: "123456789", Telegram__UnusedSecret: "synthetic-unused-secret",
    "OwnerNotifications:Enabled": "true", "Telegram:BotToken": "synthetic-colon-secret",
  };
  const safe = disableOwnerNotifications(source);
  assert.deepEqual(safe, {
    PATH: "sample-tools", ELECTROMART_TEST_MYSQL: "sample-local-connection",
    OwnerNotifications__Enabled: "false", Telegram__BotToken: "", Telegram__OwnerChatId: "",
  });
  assert.equal(source.OwnerNotifications__Enabled, "true");
  assert.doesNotMatch(JSON.stringify(safe), /synthetic-secret|123456789/);
});

test("default E2E requires only isolated local MySQL and strips inherited SMTP settings and feature overrides", () => {
  const source = {
    PATH: "sample-tools", ELECTROMART_TEST_MYSQL: "Server=127.0.0.1;Database=never_use_existing;Initial Catalog=also_existing;User ID=sample;Password=disposable-only",
    ELECTROMART_TEST_SMTP: "1", Mail__Host: "smtp.private.example", Mail__Password: "synthetic-mail-secret",
    MAIL__ENABLED: "true", "Mail:Username": "synthetic-mail-user", Mail__UnusedCredential: "synthetic-mail-secret",
    Commerce__GuestOnly: "false", COMMERCE__CHECKOUTENABLED: "false", "Commerce:GuestOnly": "false", storefront_guest_only: "false",
    CONNECTIONSTRINGS__DEFAULTCONNECTION: "Server=remote.private.example;Database=never_use_existing", "ConnectionStrings:DefaultConnection": "synthetic-connection-override",
    OwnerNotifications__Enabled: "true", Telegram__BotToken: "synthetic-owner-secret",
  };
  const safe = createE2eEnvironment(source);
  assert.equal(safe.Commerce__GuestOnly, "true");
  assert.equal(safe.Commerce__CheckoutEnabled, "true");
  assert.equal(safe.STOREFRONT_GUEST_ONLY, "true");
  assert.equal(safe.ELECTROMART_EXTENDED_FEATURES, "0");
  assert.equal(safe.Mail__Enabled, "false");
  assert.equal(safe.OwnerNotifications__Enabled, "false");
  assert.equal(safe.ELECTROMART_TEST_SMTP, undefined);
  assert.equal(safe.ELECTROMART_TEST_MYSQL, undefined);
  assert.deepEqual(Object.keys(safe).filter((key) => /^Mail(?:__|:)/i.test(key)), ["Mail__Enabled"]);
  assert.equal(safe.PATH, source.PATH);
  assert.equal(safe.NODE_ENV, "production");
  assert.equal(safe.STOREFRONT_URL, "http://localhost:3000");
  assert.equal(safe.API_BASE_URL, "http://localhost:5249");
  assert.doesNotMatch(JSON.stringify(safe), /synthetic-|smtp\.private|remote\.private|never_use_existing|also_existing/);
  assert.match(safe.ConnectionStrings__DefaultConnection, /;Database=electromart_test_[a-f0-9]{32};$/);
  assert.notEqual(safe.ConnectionStrings__DefaultConnection, createE2eEnvironment(source).ConnectionStrings__DefaultConnection);
  assert.equal(source.Mail__Password, "synthetic-mail-secret");
  assert.equal(createE2eEnvironment({ ELECTROMART_TEST_MYSQL: "Server=localhost" }).Mail__Enabled, "false");
  for (const value of [undefined, "0", "true", "false", "2"]) {
    assert.equal(createE2eEnvironment({ ELECTROMART_TEST_MYSQL: "Server=localhost", ELECTROMART_EXTENDED_FEATURES: value }).Commerce__GuestOnly, "true");
  }
});

test("extended E2E is an explicit opt-in with credential-free local SMTP capture and no owner alerts", () => {
  const source = {
    ELECTROMART_TEST_MYSQL: "Host=mysql;User ID=sample;Password=disposable-only", ELECTROMART_EXTENDED_FEATURES: "1", ELECTROMART_TEST_SMTP: "1",
    Mail__Host: "smtp.private.example", MAIL__PASSWORD: "synthetic-secret", "Mail:Username": "synthetic-user",
    Telegram__BotToken: "synthetic-owner-secret", OwnerNotifications__Enabled: "true",
  };
  const safe = createE2eEnvironment(source);
  assert.equal(safe.Commerce__GuestOnly, "false");
  assert.equal(safe.STOREFRONT_GUEST_ONLY, "false");
  assert.equal(safe.Mail__Enabled, "true");
  assert.equal(safe.Mail__Host, "127.0.0.1");
  assert.equal(safe.Mail__Port, "1025");
  assert.equal(safe.Mail__EnableSsl, "false");
  assert.equal(safe.Mail__Username, "");
  assert.equal(safe.Mail__Password, "");
  assert.equal(safe.OwnerNotifications__Enabled, "false");
  assert.equal(safe.Telegram__BotToken, "");
  assert.equal(safe.Telegram__OwnerChatId, "");
  assert.doesNotMatch(JSON.stringify(safe), /synthetic-|smtp\.private/);
  for (const readiness of [undefined, "0", "true"]) {
    assert.throws(() => createE2eEnvironment({ ...source, ELECTROMART_TEST_SMTP: readiness }), /Extended E2E requires explicit local SMTP capture readiness/);
  }
});

test("E2E refuses missing, nonlocal and ambiguous MySQL settings without exposing connection details", () => {
  for (const connection of [undefined, "", "User ID=sample;Password=private-diagnostic", "Server=remote.private.example;Password=private-diagnostic",
    "Server=localhost;Host=remote.private.example", "Server=localhost;Data Source=remote.private.example", "Server=localhost;Address=remote.private.example",
    "Server=localhost;Addr=remote.private.example", "Server=localhost;Network Address=remote.private.example", "Server=localhost;Server=127.0.0.1", "Server=localhost,remote.private.example"]) {
    assert.throws(() => createE2eEnvironment({ ELECTROMART_TEST_MYSQL: connection }), (error) => {
      assert.match(error.message, /isolated local MySQL|nonlocal or ambiguous MySQL/);
      assert.doesNotMatch(error.message, /remote\.private|private-diagnostic/);
      return true;
    });
  }
});

test("E2E TLS remains explicit and paired in both feature profiles", () => {
  for (const extended of ["0", "1"]) {
    const source = { ELECTROMART_TEST_MYSQL: "Server=localhost", ELECTROMART_EXTENDED_FEATURES: extended, ELECTROMART_TEST_SMTP: "1" };
    assert.throws(() => createE2eEnvironment({ ...source, E2E_TLS_CERT: "sample-cert" }), /requires both certificate and key/);
    assert.throws(() => createE2eEnvironment({ ...source, E2E_TLS_KEY: "sample-key" }), /requires both certificate and key/);
    const secure = createE2eEnvironment({ ...source, E2E_TLS_CERT: "sample-cert", E2E_TLS_KEY: "sample-key" });
    assert.equal(secure.Security__DevelopmentHttps, "true");
    assert.equal(secure.E2E_BASE_URL, "https://localhost:3443");
    assert.equal(secure.API_BASE_URL, "https://localhost:7220");
    assert.match(secure.NODE_OPTIONS, /e2e-ca\.cjs/);
  }
});

test("Playwright selects only guest regressions by default and preserves both dormant journey files on opt-in", { timeout: 20000 }, async () => {
  const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
  for (const extended of ["0", "1"]) {
    const { stdout } = await promisify(execFile)(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--list", "--reporter=list"], {
      cwd: frontend, env: { ...process.env, ELECTROMART_EXTENDED_FEATURES: extended }, timeout: 9000,
    });
    assert.match(stdout, /\[desktop\]/);
    assert.match(stdout, /\[mobile\]/);
    if (extended === "1") {
      assert.match(stdout, /commerce\.spec\.ts/);
      assert.match(stdout, /recovery\.spec\.ts/);
      assert.doesNotMatch(stdout, /guest-only\.spec\.ts/);
    } else {
      assert.match(stdout, /guest-only\.spec\.ts/);
      assert.doesNotMatch(stdout, /commerce\.spec\.ts|recovery\.spec\.ts/);
    }
  }
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

test("IIS frontend environment guard permits only one optional literal guest-only boolean and the narrow runtime list", { timeout: 15000 }, async () => {
  const script = fileURLToPath(new URL("./package-iis.ps1", import.meta.url));
  assert.match(await readFile(script, "utf8"), /Assert-FrontendEnvironment \$platform/);
  const command = `
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:RELEASE_TEST_SCRIPT, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'Package guard script did not parse.' }
    foreach ($name in @('Assert-FrontendEnvironment', 'Read-ReleaseXml')) {
      $function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
      if ($null -eq $function) { throw 'Package frontend environment guard is missing.' }
      . ([scriptblock]::Create($function.Extent.Text))
    }
    $required = @{ PORT = '%HTTP_PLATFORM_PORT%'; HOSTNAME = '127.0.0.1'; NODE_ENV = 'production';
      STOREFRONT_MODE = 'live'; API_BASE_URL = '%API_BASE_URL%'; STOREFRONT_URL = '%STOREFRONT_URL%' }
    function New-TestPlatform {
      $document = [Xml.XmlDocument]::new()
      $document.LoadXml('<httpPlatform><environmentVariables /></httpPlatform>')
      foreach ($name in $required.Keys) {
        $variable = $document.CreateElement('environmentVariable')
        $variable.SetAttribute('name', $name)
        $variable.SetAttribute('value', $required[$name])
        $document.DocumentElement.FirstChild.AppendChild($variable) | Out-Null
      }
      return ,$document.DocumentElement
    }
    $front = Read-ReleaseXml $env:RELEASE_TEST_FRONT_CONFIG
    Assert-FrontendEnvironment ($front.SelectSingleNode('//httpPlatform'))
    Assert-FrontendEnvironment (New-TestPlatform)
    foreach ($value in @('true', 'false', '', 'True', 'FALSE', '0', '1', ' false ', '%STOREFRONT_GUEST_ONLY%', 'private-fixture-value')) {
      $platform = New-TestPlatform
      $variable = $platform.OwnerDocument.CreateElement('environmentVariable')
      $variable.SetAttribute('name', 'STOREFRONT_GUEST_ONLY')
      $variable.SetAttribute('value', $value)
      $platform.FirstChild.AppendChild($variable) | Out-Null
      $accepted = $false
      try { Assert-FrontendEnvironment $platform; $accepted = $true }
      catch {
        if ($_.Exception.Message -cne 'Packaged STOREFRONT_GUEST_ONLY must be the boolean string true or false.') { throw 'Package boolean guard leaked an unsafe diagnostic.' }
      }
      if ($accepted -ne ($value -cin @('true', 'false'))) { throw 'Package frontend guard accepted an unsafe boolean or refused a literal boolean.' }
    }
    foreach ($mutation in @('missing-required', 'duplicate-required', 'duplicate-guest', 'unknown', 'lowercase-name', 'unsafe-required')) {
      $platform = New-TestPlatform
      $port = $platform.SelectSingleNode('environmentVariables/environmentVariable[@name="PORT"]')
      switch ($mutation) {
        'missing-required' { $platform.FirstChild.RemoveChild($port) | Out-Null }
        'duplicate-required' { $platform.FirstChild.AppendChild($port.CloneNode($true)) | Out-Null }
        'unsafe-required' { $port.SetAttribute('value', 'private-fixture-value') }
        'lowercase-name' { $port.SetAttribute('name', 'port') }
        'unknown' {
          $variable = $port.CloneNode($true)
          $variable.SetAttribute('name', 'Mail__Password')
          $variable.SetAttribute('value', 'private-fixture-value')
          $platform.FirstChild.AppendChild($variable) | Out-Null
        }
        'duplicate-guest' {
          $variable = $port.CloneNode($true)
          $variable.SetAttribute('name', 'STOREFRONT_GUEST_ONLY')
          $variable.SetAttribute('value', 'true')
          $platform.FirstChild.AppendChild($variable) | Out-Null
          $platform.FirstChild.AppendChild($variable.CloneNode($true)) | Out-Null
        }
      }
      $accepted = $false
      try { Assert-FrontendEnvironment $platform; $accepted = $true }
      catch {
        if ($_.Exception.Message -cnotin @('Frontend IIS runtime environment is incomplete or unsafe.', 'Unexpected packaged frontend environment values.')) { throw 'Package frontend list guard leaked an unsafe diagnostic.' }
      }
      if ($accepted) { throw 'Package frontend guard accepted an unsafe runtime environment list.' }
    }
    'Frontend package environment guard passed 18 cases.'
  `;
  const { stdout, stderr } = await promisify(execFile)("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    env: { ...process.env, RELEASE_TEST_SCRIPT: script, RELEASE_TEST_FRONT_CONFIG: fileURLToPath(new URL("../frontend/iis/web.config", import.meta.url)) }, timeout: 12000,
  });
  assert.equal(stdout.trim(), "Frontend package environment guard passed 18 cases.");
  assert.equal(stderr, "");
});
