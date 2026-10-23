import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

export function findCaseCollisions(paths) {
  const spellings = new Map();
  const collisions = new Set();
  for (const path of new Set(paths)) {
    const parts = path.split("/");
    for (let length = 1; length <= parts.length; length += 1) {
      const prefix = parts.slice(0, length).join("/");
      const folded = prefix.normalize("NFC").toLowerCase();
      const existing = spellings.get(folded);
      if (existing !== undefined && existing !== prefix) {
        collisions.add([existing, prefix].sort().join(" <> "));
      } else {
        spellings.set(folded, prefix);
      }
    }
  }
  return [...collisions].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { stdout } = await promisify(execFile)("git", ["ls-files", "-z"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const paths = stdout.split("\0").filter(Boolean);
    const collisions = findCaseCollisions(paths);
    if (collisions.length) {
      console.error(`Case-fold collisions in the Git index (${collisions.length}):`);
      for (const collision of collisions) console.error(JSON.stringify(collision));
      process.exitCode = 1;
    } else {
      console.log(`Git index case check passed (${paths.length} tracked paths).`);
    }
  } catch {
    console.error("Could not inspect the Git index. No files were changed.");
    process.exitCode = 1;
  }
}
