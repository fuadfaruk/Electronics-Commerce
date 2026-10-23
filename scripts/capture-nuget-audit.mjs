import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function captureNugetAudit(directory = join(root, "artifacts/security"), { run = promisify(execFile) } = {}) {
  const output = resolve(directory);
  const reportPath = join(output, "nuget-audit.json");
  const diagnosticsPath = join(output, "nuget-audit-collection.json");
  const args = ["list", "backend/ElectroApi.slnx", "package", "--vulnerable", "--include-transitive", "--format", "json", "--output-version", "1", "--no-restore"];
  const options = { cwd: root, encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, shell: false, windowsHide: true };
  const diagnostics = {
    schemaVersion: 1, status: "failed", command: "dotnet", args, timeoutMs: options.timeout,
    exitCode: null, errorCode: null, signal: null, timedOut: false, jsonParsed: false,
    stderrPresent: false, stdoutBytes: 0, stderrBytes: 0,
    failure: "NuGet audit collection did not complete.",
  };
  await mkdir(output, { recursive: true });
  // Invalidate earlier evidence before a new subprocess can fail or be interrupted.
  await rm(reportPath, { force: true });
  await writeFile(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`);
  let stdout = "";
  let stderr = "";
  let failure = null;
  let report;
  try {
    const result = await run("dotnet", args, options);
    stdout = typeof result.stdout === "string" ? result.stdout : "";
    stderr = typeof result.stderr === "string" ? result.stderr : "";
    diagnostics.exitCode = 0;
  } catch (error) {
    stdout = typeof error.stdout === "string" ? error.stdout : "";
    stderr = typeof error.stderr === "string" ? error.stderr : "";
    diagnostics.exitCode = Number.isInteger(error.code) ? error.code : null;
    diagnostics.errorCode = typeof error.code === "string" ? error.code : null;
    diagnostics.signal = typeof error.signal === "string" ? error.signal : null;
    diagnostics.timedOut = error.code === "ETIMEDOUT" || (error.killed === true && error.signal === options.killSignal && error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
    failure = diagnostics.timedOut ? "NuGet audit command timed out." :
      diagnostics.exitCode !== null ? "NuGet audit command exited unsuccessfully." : "NuGet audit command could not execute or complete.";
  }
  diagnostics.stdoutBytes = Buffer.byteLength(stdout);
  diagnostics.stderrBytes = Buffer.byteLength(stderr);
  diagnostics.stderrPresent = stderr.trim().length > 0;
  try {
    report = JSON.parse(stdout);
    diagnostics.jsonParsed = true;
    if (report?.version !== 1 || typeof report.parameters !== "string" || !Array.isArray(report.projects)) {
      failure ??= "NuGet audit command did not produce a version-1 report.";
    }
  } catch {
    failure ??= "NuGet audit command did not produce a single JSON report.";
  }
  if (diagnostics.stderrPresent) failure ??= "NuGet audit command wrote stderr; collection requires review.";
  await Promise.all([
    writeFile(join(output, "nuget-audit.stdout.txt"), stdout),
    writeFile(join(output, "nuget-audit.stderr.txt"), stderr),
  ]);
  if (!failure) {
    try { await writeFile(reportPath, stdout); }
    catch { failure = "NuGet audit report could not be written."; }
  }
  diagnostics.status = failure ? "failed" : "captured";
  diagnostics.failure = failure;
  if (failure) await rm(reportPath, { force: true });
  try { await writeFile(diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`); }
  catch {
    await rm(reportPath, { force: true });
    throw new Error("NuGet audit collection diagnostics could not be written.");
  }
  if (failure) throw new Error(failure);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await captureNugetAudit(process.argv[2]);
    console.log("Machine-readable NuGet audit captured; gate evaluation is separate.");
  } catch {
    console.error("NuGet audit collection failed; inspect the retained collection diagnostics and stdout/stderr artifacts.");
    process.exitCode = 1;
  }
}
