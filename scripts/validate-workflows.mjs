import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
for (const name of ["commerce-ci.yml", "promote-iis.yml"]) {
  const document = yaml.load(await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));
  if (!document?.name || !document?.on || !document?.jobs || document.permissions?.contents !== "read") throw new Error("Release workflow structure is incomplete.");
  for (const job of Object.values(document.jobs)) {
    if (!Array.isArray(job.steps) || !job["runs-on"]) throw new Error("Release job has no runner or steps.");
    for (const step of job.steps) {
      if (step.uses?.includes("actions/") && !/@[a-f0-9]{40}$/.test(step.uses)) throw new Error("External actions must be revision-pinned.");
    }
  }
}
console.log("Paired CI and protected manual promotion YAML parsed successfully.");
