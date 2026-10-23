import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

export function validateWorkflow(document) {
  if (!document?.name || !document?.on || !document?.jobs || document.permissions?.contents !== "read") throw new Error("Release workflow structure is incomplete.");
  for (const [jobId, job] of Object.entries(document.jobs)) {
    if (!Array.isArray(job.steps) || !job["runs-on"]) throw new Error("Release job has no runner or steps.");
    // Execution contexts are available in step env, but not jobs.<job_id>.env.
    for (const value of Object.values(job.env ?? {})) {
      if (typeof value !== "string") continue;
      for (const [, expression] of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
        const code = expression.replace(/'(?:[^']|'')*'/g, "");
        const unavailable = /(?<![\w.-])(runner|job|steps|env)\b/i.exec(code)?.[1];
        if (unavailable) throw new Error(`jobs.${jobId}.env cannot use the ${unavailable.toLowerCase()} context; put runtime settings in step-level env.`);
      }
    }
    for (const step of job.steps) {
      if (step.uses?.includes("actions/") && !/@[a-f0-9]{40}$/.test(step.uses)) throw new Error("External actions must be revision-pinned.");
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const name of ["commerce-ci.yml", "promote-iis.yml"]) {
    validateWorkflow(yaml.load(await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8")));
  }
  console.log("Paired workflow YAML structure, action pins, and job environment contexts validated successfully.");
}
