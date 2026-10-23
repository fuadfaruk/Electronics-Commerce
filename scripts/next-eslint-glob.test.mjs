import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const parent = process.platform === "win32" ? join(os.tmpdir(), "kilo") : os.tmpdir();
  await access(parent);
  const directory = await mkdtemp(join(parent, "next-eslint-glob-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ["apps/store/pages", "apps/admin/src/app/dashboard", "apps/.hidden", "with space/nested"]) {
    await mkdir(join(directory, path), { recursive: true });
  }
  await writeFile(join(directory, "apps/store/pages/about.jsx"), "export default function About() { return null; }\n");
  await writeFile(join(directory, "apps/admin/src/app/dashboard/page.tsx"), "export default function Dashboard() { return null; }\n");
  await writeFile(join(directory, "apps/not-a-directory.txt"), "fixture\n");
  return directory;
}

test("Next ESLint uses the version-scoped safe adapter without the vulnerable dependency chain", async () => {
  const manifest = JSON.parse(await readFile(new URL("../frontend/package.json", import.meta.url), "utf8"));
  const pluginManifest = require("@next/eslint-plugin-next/package.json");
  const replacement = JSON.parse(await readFile(join(dirname(pluginRequire.resolve("fast-glob")), "package.json"), "utf8"));
  assert.equal(pluginManifest.version, "16.4.2");
  assert.equal(manifest.overrides[`@next/eslint-plugin-next@${pluginManifest.version}`]["fast-glob"], "file:./tooling/next-eslint-glob");
  assert.equal(replacement.name, "@electromart/next-eslint-glob");
  assert.deepEqual(replacement.dependencies, { tinyglobby: "0.2.17" });
  const lock = JSON.parse(await readFile(new URL("../frontend/package-lock.json", import.meta.url), "utf8"));
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

test("Next still rejects HTML links to internal pages and app routes with globbed roots", async (t) => {
  const directory = await fixture(t);
  const { ESLint } = require("eslint");
  const eslint = new ESLint({
    cwd: directory,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ["**/*.jsx"],
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { "@next/next": plugin },
      settings: { next: { rootDir: `${slash(directory)}/apps/*` } },
      rules: { "@next/next/no-html-link-for-pages": "error" },
    }],
  });
  for (const route of ["/about", "/dashboard"]) {
    const [result] = await eslint.lintText(`const Component = () => <a href="${route}">Internal</a>;`,
      { filePath: join(directory, "check.jsx") });
    assert.equal(result.errorCount, 1, route);
    assert.equal(result.messages[0].ruleId, "@next/next/no-html-link-for-pages", route);
  }
});
