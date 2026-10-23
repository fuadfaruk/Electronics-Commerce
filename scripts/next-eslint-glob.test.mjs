import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import os from "node:os";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const plugin = require("@next/eslint-plugin-next");
const pluginRequire = createRequire(require.resolve("@next/eslint-plugin-next"));
const { globSync } = pluginRequire("fast-glob");
const { getRootDirs } = require("@next/eslint-plugin-next/dist/utils/get-root-dirs.js");
const slash = (path) => path.replaceAll("\\", "/");
const sorted = (paths) => paths.map(slash).sort();

async function fixture(t) {
  // Hosted runners provide RUNNER_TEMP; the local Windows sandbox uses kilo.
  const parent = process.env.RUNNER_TEMP ?? (process.platform === "win32" ? join(os.tmpdir(), "kilo") : os.tmpdir());
  await access(parent);
  const directory = await mkdtemp(join(parent, "next-eslint-glob-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ["apps/store/pages", "apps/admin/src/app/dashboard", "apps/.hidden", "with space/nested"]) {
    await mkdir(join(directory, path), { recursive: true });
  }
  await writeFile(join(directory, "apps/store/pages/about.jsx"), "export default function About() { return null; }\n");
  await writeFile(join(directory, "apps/admin/src/app/page.tsx"), "export default function Home() { return null; }\n");
  await writeFile(join(directory, "apps/admin/src/app/dashboard/page.tsx"), "export default function Dashboard() { return null; }\n");
  await writeFile(join(directory, "apps/not-a-directory.txt"), "fixture\n");
  // Windows TEMP may contain an 8.3 alias that directory crawlers do not enumerate.
  return realpath(directory);
}

test("fixtures use GitHub RUNNER_TEMP without a pre-existing kilo directory", async (t) => {
  const runnerTemp = await fixture(t);
  const previous = process.env.RUNNER_TEMP;
  try {
    process.env.RUNNER_TEMP = runnerTemp;
    assert.equal(dirname(await fixture(t)), runnerTemp);
  } finally {
    if (previous === undefined) delete process.env.RUNNER_TEMP;
    else process.env.RUNNER_TEMP = previous;
  }
});

test("Next ESLint uses the version-scoped safe adapter without the vulnerable dependency chain", async () => {
  const manifest = JSON.parse(await readFile(new URL("../frontend/package.json", import.meta.url), "utf8"));
  const pluginManifest = require("@next/eslint-plugin-next/package.json");
  const replacement = JSON.parse(await readFile(join(dirname(pluginRequire.resolve("fast-glob")), "package.json"), "utf8"));
  assert.equal(pluginManifest.version, "16.4.2");
  // A root dependency reference avoids resolving a relative override inside the plugin.
  assert.equal(manifest.devDependencies["fast-glob"], "file:./tooling/next-eslint-glob");
  assert.equal(manifest.overrides[`@next/eslint-plugin-next@${pluginManifest.version}`]["fast-glob"], "$fast-glob");
  assert.equal(pluginRequire.resolve("fast-glob"), require.resolve("fast-glob"));
  assert.equal(replacement.name, "@electromart/next-eslint-glob");
  assert.deepEqual(replacement.dependencies, { tinyglobby: "0.2.17" });
  const lock = JSON.parse(await readFile(new URL("../frontend/package-lock.json", import.meta.url), "utf8"));
  assert.deepEqual(lock.packages["node_modules/fast-glob"], { resolved: "tooling/next-eslint-glob", link: true });
  assert.equal(lock.packages["tooling/next-eslint-glob"].name, replacement.name);
  assert.deepEqual(lock.packages["tooling/next-eslint-glob"].dependencies, replacement.dependencies);
  assert.equal(Object.keys(lock.packages).some((path) => path.startsWith("node_modules/@next/eslint-plugin-next/") && path.includes("next-eslint-glob")), false);
  assert.equal(Object.keys(lock.packages).some((path) => /(?:^|\/)node_modules\/(?:braces|micromatch)(?:\/|$)/.test(path)), false);
});

test("directory globbing preserves literal, relative, absolute, wildcard and brace semantics", async (t) => {
  const directory = await fixture(t);
  const absolute = slash(directory);
  const relativeBase = slash(relative(process.cwd(), directory));
  const cases = [
    [`${absolute}/apps/store`, [`${absolute}/apps/store`]],
    [`${absolute}/apps/store/`, [`${absolute}/apps/store`]],
    [`${absolute}/apps/*`, [`${absolute}/apps/admin`, `${absolute}/apps/store`]],
    [`${absolute}/apps/{store,admin}`, [`${absolute}/apps/admin`, `${absolute}/apps/store`]],
    [`${absolute}/with space`, [`${absolute}/with space`]],
    [`${absolute}/apps/absent`, []],
    [`${absolute}/apps/*.txt`, []],
    [`${relativeBase}/apps/store`, [`${relativeBase}/apps/store`]],
    [`${relativeBase}/apps/*`, [`${relativeBase}/apps/admin`, `${relativeBase}/apps/store`]],
  ];
  for (const [pattern, expected] of cases) {
    assert.deepEqual(sorted(globSync(pattern, { onlyDirectories: true })), sorted(expected), pattern);
  }
});

test("Next root directory settings preserve default, string and array discovery", async (t) => {
  const directory = await fixture(t);
  const absolute = slash(directory);
  assert.deepEqual(getRootDirs({ cwd: directory, settings: {} }), [directory]);
  assert.deepEqual(sorted(getRootDirs({ cwd: directory, settings: { next: { rootDir: `${absolute}/apps/*` } } })),
    [`${absolute}/apps/admin`, `${absolute}/apps/store`]);
  assert.deepEqual(sorted(getRootDirs({ cwd: directory, settings: { next: { rootDir: [
    join(directory, "apps", "store"), `${absolute}/apps/admin`, `${absolute}/absent`,
  ] } } })), [`${absolute}/apps/admin`, `${absolute}/apps/store`]);
});

test("unsupported glob API changes fail explicitly instead of silently weakening lint", () => {
  for (const [pattern, options] of [[".", undefined], [".", {}], [".", { onlyDirectories: false }],
    [".", { onlyDirectories: true, cwd: "." }], [["."], { onlyDirectories: true }]]) {
    assert.throws(() => globSync(pattern, options), /supports only directory discovery/);
  }
});

test("Next lint with globbed roots matches default roots for pages and app routes", async (t) => {
  const directory = await fixture(t);
  const { ESLint } = require("eslint");
  const createLinter = (cwd, settings = {}) => new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ["**/*.jsx"],
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { "@next/next": plugin },
      settings,
      rules: { "@next/next/no-html-link-for-pages": "error" },
    }],
  });
  const eslint = createLinter(directory, { next: { rootDir: `${slash(directory)}/apps/*` } });
  for (const [route, app] of [["/about", "store"], ["/", "admin"], ["/dashboard", "admin"]]) {
    const source = `const Component = () => <a href="${route}">Internal</a>;`;
    const [result] = await eslint.lintText(source,
      { filePath: join(directory, "check.jsx") });
    // A default root bypasses glob discovery: preserve upstream behavior even for
    // its nested-app-route coverage gap, rather than silently weakening the rule.
    const appRoot = join(directory, "apps", app);
    const [baseline] = await createLinter(appRoot).lintText(source, { filePath: join(appRoot, "check.jsx") });
    assert.deepEqual(result.messages, baseline.messages, route);
    if (route !== "/dashboard") {
      assert.equal(result.errorCount, 1, route);
      assert.equal(result.messages[0].ruleId, "@next/next/no-html-link-for-pages", route);
    }
  }
});
