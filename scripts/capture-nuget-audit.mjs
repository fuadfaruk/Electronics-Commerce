import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2]);
await access(dirname(output));
await mkdir(output, { recursive: true });
const { stdout } = await promisify(execFile)("dotnet", ["list", "backend/ElectroApi.slnx", "package", "--vulnerable", "--include-transitive", "--format", "json", "--output-version", "1"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
JSON.parse(stdout);
await writeFile(join(output, "nuget-audit.json"), stdout);
console.log("Machine-readable NuGet audit captured; gate evaluation is separate.");
