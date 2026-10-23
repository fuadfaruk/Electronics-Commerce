import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function verifyEfTool({ run = promisify(execFile) } = {}) {
  let tool;
  try {
    const manifest = JSON.parse(await readFile(new URL("../.config/dotnet-tools.json", import.meta.url), "utf8"));
    tool = manifest.tools?.["dotnet-ef"];
    if (!/^\d+\.\d+\.\d+$/.test(tool?.version) || tool.rollForward !== false) throw new Error();
  } catch {
    throw new Error("EF CLI must have an exact stable version with roll-forward disabled in .config/dotnet-tools.json.");
  }

  let result;
  try {
    result = await run("dotnet", ["ef", "--version"], {
      cwd: root, encoding: "utf8", timeout: 30_000, killSignal: "SIGKILL",
      maxBuffer: 64 * 1024, shell: false, windowsHide: true,
    });
  } catch {
    throw new Error("EF CLI version command failed; restore the pinned local tool and check the .NET runtime.");
  }
  if (typeof result?.stdout !== "string" || typeof result.stderr !== "string" || result.stderr.trim()) {
    throw new Error("EF CLI version command returned incomplete output or stderr diagnostics.");
  }
  // EF prints its banner and version on separate lines. Ignore layout, not content.
  const actual = result.stdout.trim().replace(/\s+/g, " ");
  if (actual !== `Entity Framework Core .NET Command-line Tools ${tool.version}`) {
    throw new Error(`Expected EF CLI ${tool.version}; dotnet ef --version returned unexpected output.`);
  }
  return tool.version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const version = await verifyEfTool();
    console.log(`Pinned EF CLI verified: ${version}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
