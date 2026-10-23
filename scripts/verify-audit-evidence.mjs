import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateNpmAudit, checkNugetAudit } from "./audit-gate.mjs";

const [directory, revision] = process.argv.slice(2);
try {
  if (!directory || !/^[a-f0-9]{40}$/.test(revision ?? "")) throw new Error("Invalid evidence selection.");
  const [summary, runtime, full, nuget, policy] = await Promise.all(["audit-summary.json", "npm-audit-runtime.json", "npm-audit-full.json", "nuget-audit.json", "dev-advisory-exceptions.json"].map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8"))));
  const result = evaluateNpmAudit(runtime, full);
  checkNugetAudit(nuget);
  if (result.status !== "passed" || summary.schemaVersion !== 1 || summary.policy !== "strict-zero-advisories" || summary.status !== "passed" || summary.revision !== revision || summary.runtimeVulnerabilityCount !== 0 || summary.fullVulnerabilityCount !== 0 || summary.nugetVulnerabilityCount !== 0 || policy.schemaVersion !== 1 || !Array.isArray(policy.exceptions) || policy.exceptions.length) throw new Error("Security evidence is not promotable.");
} catch {
  console.error("Paired artifacts require intact zero-advisory security evidence from the exact revision.");
  process.exitCode = 1;
}
