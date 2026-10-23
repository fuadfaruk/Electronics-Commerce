import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const severities = ["info", "low", "moderate", "high", "critical"];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function auditEntries(report) {
  if (!object(report) || report.auditReportVersion !== 2 || report.error ||
      !object(report.vulnerabilities) || !object(report.metadata?.vulnerabilities)) {
    throw new Error("npm audit report is missing, malformed, or incomplete.");
  }
  const entries = Object.entries(report.vulnerabilities);
  const counts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  for (const [name, entry] of entries) {
    if (!object(entry) || entry.name !== name || !severities.includes(entry.severity) ||
        typeof entry.isDirect !== "boolean" || typeof entry.range !== "string" ||
        !Array.isArray(entry.via) || entry.via.length === 0 ||
        !Array.isArray(entry.nodes) || entry.nodes.length === 0 ||
        entry.nodes.some((node) => typeof node !== "string")) {
      throw new Error("npm audit contains an unrecognized finding.");
    }
    counts[entry.severity] += 1;
  }
  if (report.metadata.vulnerabilities.total !== entries.length ||
      severities.some((severity) => report.metadata.vulnerabilities[severity] !== counts[severity])) {
    throw new Error("npm audit counts do not match the reported findings.");
  }
  return entries;
}

function normalizeVia(via) {
  return via.map((entry) => {
    if (typeof entry === "string") return { package: entry };
    if (!object(entry)) throw new Error("Unrecognized advisory identifier.");
    const id = /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/.exec(entry.url)?.[1];
    if (!id || !Number.isSafeInteger(entry.source) || !severities.includes(entry.severity) ||
        typeof entry.dependency !== "string" || typeof entry.range !== "string") {
      throw new Error("Unrecognized advisory identifier.");
    }
    return { advisoryId: id, npmSourceId: entry.source, dependency: entry.dependency, range: entry.range, severity: entry.severity };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function rootsFor(name, entries, visiting = new Set()) {
  if (visiting.has(name) || !entries.has(name)) throw new Error("Incomplete or cyclic advisory chain.");
  const next = new Set([...visiting, name]);
  return normalizeVia(entries.get(name).via).flatMap((via) =>
    via.package ? rootsFor(via.package, entries, next) : [via]);
}

export function evaluateNpmAudit(runtimeReport, fullReport, now = new Date()) {
  const runtime = auditEntries(runtimeReport);
  const full = auditEntries(fullReport);
  const failures = runtime.length ? ["Runtime dependency advisories are not permitted."] : [];
  const fullEntries = new Map(full);
  for (const [name, entry] of full) {
    const roots = rootsFor(name, fullEntries);
    failures.push(`Full dependency audit finding is not permitted: ${JSON.stringify(name)} (${[...new Set(roots.map((item) => item.advisoryId))].join(", ")}).`);
  }
  return {
    schemaVersion: 1,
    policy: "strict-zero-advisories",
    checkedAt: now.toISOString(),
    status: failures.length ? "failed" : "passed",
    runtimeVulnerabilityCount: runtime.length,
    fullVulnerabilityCount: full.length,
    failures,
  };
}

export function checkNugetAudit(report) {
  const required = ["ElectroApi.Api", "ElectroApi.Core", "ElectroApi.Infrastructure", "ElectroApi.Integration.Tests", "ElectroApi.Unit.Tests"];
  if (!object(report) || report.version !== 1) {
    throw new Error("NuGet audit report schema must be a version-1 JSON object.");
  }
  if (typeof report.parameters !== "string" ||
      ["--vulnerable", "--include-transitive"].some((flag) => !report.parameters.trim().split(/\s+/).includes(flag))) {
    throw new Error("NuGet audit parameters must include --vulnerable and --include-transitive.");
  }
  const array = (value, field) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error(`NuGet audit ${field} is malformed; expected an array.`);
    return value;
  };
  const checkMessages = (container, scope) => {
    // NuGet JSON version 1 aggregates warning/error issues into structured problems.
    for (const field of ["problems", "logs"]) {
      const entries = array(container[field], `${scope} ${field}`);
      const levels = field === "problems" ? ["warning", "error"] : ["debug", "verbose", "information", "info", "minimal", "warning", "error"];
      for (const entry of entries) {
        if (!object(entry) || typeof entry.level !== "string" || !levels.includes(entry.level.toLowerCase()) ||
            typeof (field === "problems" ? entry.text : entry.message ?? entry.text) !== "string" ||
            ["project", "text", "message"].some((key) => entry[key] !== undefined && (typeof entry[key] !== "string" || !entry[key].trim()))) {
          throw new Error(`NuGet audit ${scope} ${field} entries are malformed.`);
        }
      }
      const blocking = entries.find((entry) => /^(warning|error)$/i.test(entry.level));
      if (blocking) throw new Error(`NuGet audit ${scope} contains ${blocking.level.toLowerCase()} ${field}; auditing did not complete.`);
    }
  };
  if (array(report.sources, "sources").some((source) => typeof source !== "string" || !source.trim())) {
    throw new Error("NuGet audit sources entries are malformed.");
  }
  checkMessages(report, "report");
  if (!Array.isArray(report.projects)) throw new Error("NuGet audit projects is malformed; expected an array.");
  const covered = new Map();
  for (const project of report.projects) {
    if (!object(project) || typeof project.path !== "string" || !project.path.trim()) {
      throw new Error("NuGet audit project entries must contain a valid path.");
    }
    const name = required.find((candidate) => project.path.replaceAll("\\", "/").endsWith(`/${candidate}.csproj`));
    if (!name) throw new Error("NuGet audit report contains an unexpected project.");
    if (covered.has(name)) throw new Error(`NuGet audit report contains duplicate project: ${name}.`);
    covered.set(name, project);
  }
  for (const name of required) {
    if (!covered.has(name)) throw new Error(`NuGet audit report is missing required project: ${name}.`);
  }
  for (const [name, project] of covered) {
    checkMessages(project, `project ${name}`);
    // Clean --vulnerable reports legitimately omit frameworks and package lists.
    for (const framework of array(project.frameworks, `project ${name} frameworks`)) {
      if (!object(framework) || typeof framework.framework !== "string" || !framework.framework.trim()) {
        throw new Error(`NuGet audit project ${name} framework entries are malformed.`);
      }
      checkMessages(framework, `framework in ${name}`);
      for (const field of ["topLevelPackages", "transitivePackages"]) {
        for (const entry of array(framework[field], `framework ${field}`)) {
          if (!object(entry) || typeof entry.id !== "string" || !entry.id.trim() ||
              typeof entry.resolvedVersion !== "string" || !entry.resolvedVersion.trim() ||
              (entry.requestedVersion !== undefined && typeof entry.requestedVersion !== "string")) {
            throw new Error(`NuGet audit ${field} entries are malformed.`);
          }
          if (!Array.isArray(entry.vulnerabilities)) throw new Error("NuGet audit package vulnerability evidence is missing or malformed.");
          if (entry.vulnerabilities.length > 0) throw new Error("NuGet dependency advisories are not permitted.");
        }
      }
    }
  }
}

export async function readNugetAudit(directory) {
  let collection;
  try { collection = JSON.parse(await readFile(join(directory, "nuget-audit-collection.json"), "utf8")); }
  catch { throw new Error("NuGet audit collection diagnostics are missing or malformed."); }
  if (!object(collection) || collection.schemaVersion !== 1 || !["captured", "failed"].includes(collection.status) ||
      !(collection.exitCode === null || Number.isInteger(collection.exitCode)) ||
      typeof collection.jsonParsed !== "boolean" || typeof collection.stderrPresent !== "boolean" || typeof collection.timedOut !== "boolean" ||
      !(collection.errorCode === null || typeof collection.errorCode === "string") || !(collection.signal === null || typeof collection.signal === "string") ||
      !(collection.failure === null || typeof collection.failure === "string")) {
    throw new Error("NuGet audit collection diagnostics are malformed or incomplete.");
  }
  if (collection.status !== "captured" || collection.exitCode !== 0 || !collection.jsonParsed || collection.stderrPresent ||
      collection.timedOut || collection.errorCode !== null || collection.signal !== null || collection.failure !== null) {
    throw new Error("NuGet audit collection did not complete successfully; inspect the retained collection diagnostics.");
  }
  let report;
  try { report = JSON.parse(await readFile(join(directory, "nuget-audit.json"), "utf8")); }
  catch { throw new Error("NuGet audit report is missing or is not a single JSON document."); }
  checkNugetAudit(report);
  return report;
}

async function npmAudit(frontend, omitDev, outputPath) {
  const args = ["audit", "--json", "--registry=https://registry.npmjs.org", ...(omitDev ? ["--omit=dev"] : [])];
  // Invoke npm's JS entry point on Windows without a shell or interpolated commands.
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (process.platform === "win32") await access(npmCli);
  let stdout;
  let exitCode = 0;
  try {
    ({ stdout } = await promisify(execFile)(process.platform === "win32" ? process.execPath : "npm",
      process.platform === "win32" ? [npmCli, ...args] : args,
      { cwd: frontend, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    stdout = error.stdout;
    exitCode = error.code;
  }
  await writeFile(outputPath, typeof stdout === "string" ? stdout : "{}\n");
  if (![0, 1].includes(exitCode)) throw new Error("npm audit did not complete successfully.");
  const report = JSON.parse(stdout);
  if ((auditEntries(report).length === 0) !== (exitCode === 0)) throw new Error("npm audit exit code does not match its report.");
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = resolve(process.argv[2] ?? join(root, "artifacts/security"));
  let summary;
  try {
    await access(dirname(output));
    await mkdir(output, { recursive: true });
    const frontend = resolve(root, "frontend");
    const [runtime, full] = await Promise.all([
      npmAudit(frontend, true, join(output, "npm-audit-runtime.json")),
      npmAudit(frontend, false, join(output, "npm-audit-full.json")),
    ]);
    const policyPath = resolve(root, "scripts/dev-advisory-exceptions.json");
    const policy = JSON.parse(await readFile(policyPath, "utf8"));
    if (policy.schemaVersion !== 1 || !Array.isArray(policy.exceptions) || policy.exceptions.length !== 0) {
      throw new Error("Strict security policy does not allow advisory exceptions.");
    }
    summary = evaluateNpmAudit(runtime, full);
    try {
      await readNugetAudit(output);
      summary.nugetVulnerabilityCount = 0;
    } catch (error) {
      summary.status = "failed";
      summary.failures.push(error.message);
    }
    await writeFile(join(output, "dev-advisory-exceptions.json"), `${JSON.stringify(policy, null, 2)}\n`);
    summary.revision = process.env.GITHUB_SHA ?? null;
  } catch {
    summary = { schemaVersion: 1, status: "failed", failures: ["Security reports could not be validated. No audit failure is ignored."] };
  }
  try {
    await writeFile(join(output, "audit-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  } catch {
    console.error("Security evidence could not be written.");
  }
  if (summary.status !== "passed") {
    for (const failure of summary.failures) console.error(failure);
    process.exitCode = 1;
  } else {
    console.log("Security gate passed: runtime, full npm, and NuGet audits contain zero advisories. Deployment approval is separate.");
  }
}
