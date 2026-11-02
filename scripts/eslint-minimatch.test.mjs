import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const frontend = fileURLToPath(new URL("../frontend/", import.meta.url));
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const minimatch = require("minimatch");
const legacyConsumers = {
  eslint: "9.39.5",
  "@eslint/config-array": "0.21.2",
  "@eslint/eslintrc": "3.3.7",
  "eslint-plugin-import": "2.32.0",
  "eslint-plugin-react": "7.37.5",
  "eslint-plugin-jsx-a11y": "6.10.2",
};

async function fixture(t) {
  const parent = process.env.RUNNER_TEMP ?? (process.platform === "win32" ? join(os.tmpdir(), "kilo") : os.tmpdir());
  await access(parent);
  const directory = await mkdtemp(join(parent, "eslint-minimatch-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}

function linter(cwd, rules) {
  const { ESLint } = require("eslint");
  return new ESLint({
    cwd, overrideConfigFile: true,
    overrideConfig: [{
      files: ["**/*.{js,jsx}"],
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: {
        import: require("eslint-plugin-import"),
        react: require("eslint-plugin-react"),
        "jsx-a11y": require("eslint-plugin-jsx-a11y"),
      },
      rules,
    }],
  });
}

test("every pinned legacy consumer resolves the adapter and modern consumers resolve the audited engine", async () => {
  const manifest = JSON.parse(await readFile(join(frontend, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(frontend, "package-lock.json"), "utf8"));
  assert.equal(manifest.devDependencies.eslint, legacyConsumers.eslint);
  assert.equal(manifest.devDependencies.minimatch, "file:./tooling/eslint-minimatch");
  for (const [name, version] of Object.entries(legacyConsumers)) {
    const consumer = createRequire(require.resolve(name));
    const packageJson = JSON.parse(await readFile(join(frontend, "node_modules", name, "package.json"), "utf8"));
    assert.equal(packageJson.version, version, name);
    assert.equal(manifest.overrides[`${name}@${version}`].minimatch, "$minimatch", name);
    assert.equal(consumer.resolve("minimatch"), require.resolve("minimatch"), name);
    assert.equal(consumer("minimatch"), minimatch, name);
  }
  const engineRequire = createRequire(require.resolve("minimatch"));
  assert.equal(engineRequire("minimatch-safe/package.json").name, "minimatch");
  assert.equal(engineRequire("minimatch-safe/package.json").version, "11.0.4");
  const estreeRequire = createRequire(require.resolve("@typescript-eslint/typescript-estree"));
  assert.equal(estreeRequire("minimatch/package.json").version, "11.0.4");
  assert.equal(typeof estreeRequire("minimatch").minimatch, "function");
  assert.notEqual(estreeRequire("minimatch"), minimatch);
  assert.deepEqual(lock.packages["node_modules/minimatch"], { resolved: "tooling/eslint-minimatch", link: true });
  for (const [path, entry] of Object.entries(lock.packages)) {
    assert.equal(path.startsWith("node_modules/") && path.includes("/tooling/eslint-minimatch"), false, path);
    if (entry.name === "minimatch" || /\/minimatch\/-\/minimatch-/.test(entry.resolved ?? "")) {
      assert.equal(entry.version, "11.0.4", path);
      assert.equal(entry.resolved, "https://registry.npmjs.org/minimatch/-/minimatch-11.0.4.tgz");
      assert.match(entry.integrity, /^sha512-/);
    }
  }
});

test("callable and constructor APIs retain lint glob options and partial directory matching", () => {
  const cases = [
    ["src/a.ts", "src/*.{js,ts}", {}, true],
    ["src/a.jsx", "src/*.{js,ts}", {}, false],
    ["src/sub/a.ts", "src/**/*.ts", {}, true],
    ["src/sub/a.ts", "*.ts", { matchBase: true }, true],
    ["src/.a.ts", "src/*.ts", {}, false],
    ["src/.a.ts", "src/*.ts", { dot: true }, true],
    ["foo.js", "@(foo|bar).js", {}, true],
    ["baz.js", "@(foo|bar).js", {}, false],
    ["a.js", "!*.ts", {}, true],
    ["a.ts", "!*.ts", { flipNegate: true }, true],
    ["#value", "#*", {}, false],
    ["#value", "#*", { nocomment: true }, true],
    ["a/b", "**", { noglobstar: true }, false],
  ];
  for (const [value, pattern, options, expected] of cases) {
    assert.equal(minimatch(value, pattern, options), expected, `${pattern}: ${value}`);
    assert.equal(new minimatch.Minimatch(pattern, options).match(value), expected, `${pattern}: ${value}`);
  }
  const matcher = new minimatch.Minimatch(" src/**/*.js ");
  assert.equal(matcher.pattern, "src/**/*.js");
  assert.equal(matcher.match("src/nested", true), true);
  assert.equal(matcher.match("elsewhere/nested", true), false);
  assert.deepEqual(minimatch.match(["a.js", "b.ts"], "*.js"), ["a.js"]);
  assert.deepEqual(["a.js", "b.ts"].filter(minimatch.filter("*.ts")), ["b.ts"]);
  assert.deepEqual(minimatch.braceExpand("{a,b}.js"), ["a.js", "b.js"]);
  assert.equal(minimatch.defaults({ dot: true })(".hidden", "*"), true);
  assert.equal(new (minimatch.Minimatch.defaults({ dot: true }))("*").match(".hidden"), true);
  assert.throws(() => minimatch("a", null), TypeError);
});

test("legacy Windows separators and POSIX escapes are normalized independently", () => {
  const windows = minimatch.defaults({ platform: "win32" });
  const posix = minimatch.defaults({ platform: "linux" });
  assert.equal(windows("C:\\with space\\src\\a.js", "C:\\with space\\src\\*.js"), true);
  assert.equal(windows("src/[literal].js", "src/\\[literal\\].js", { allowWindowsEscape: true }), true);
  assert.equal(posix("src/[literal].js", "src/\\[literal\\].js", { allowWindowsEscape: false }), true);
  assert.equal(windows("src/[literal].js", "src/\\[literal\\].js", { allowWindowsEscape: false, windowsPathsNoEscape: false }), true);
  assert.equal(posix("src/a.js", "src\\*.js"), false);
});

test("makeRe test-only facade preserves legacy import allow/forbid boundaries without regex generation", () => {
  const cases = [
    ["foo/**/bar", "foo/bar", false],
    ["foo/**/bar", "foo/x/bar", true],
    ["foo/*", "foo/bar/", false],
    ["**/*.js", "a.js", false],
    ["**/*.js", "x/a.js", true],
    ["foo/**", "foo/", true],
    ["foo/**", "foo/.hidden", true],
    ["foo/**", "foo/x/.hidden", false],
    ["**", ".hidden", false],
    ["foo/**/**/bar", "foo/x/bar", false],
    ["foo/**/**/bar", "foo/x/y/bar", true],
    ["!foo/**", "foo/x", false],
    ["!foo/**", "other/x", true],
    ["foo/{a,b}", "foo/a", true],
    ["foo/{a,b}", "foo/c", false],
  ];
  for (const [pattern, value, expected] of cases) {
    const predicate = minimatch.makeRe(pattern);
    assert.equal(predicate instanceof RegExp, false);
    assert.deepEqual(Object.keys(predicate), ["test"]);
    assert.equal(predicate.test(value), expected, `${pattern}: ${value}`);
  }
  assert.equal(minimatch.makeRe("foo/**", { dot: true }).test("foo/x/.hidden"), true);
  const literalBraces = minimatch.makeRe("lib/\\{a,b\\}", { platform: "linux" });
  assert.equal(literalBraces.test("lib/{a,b}"), true);
  assert.equal(literalBraces.test("lib/a"), false);
  assert.equal(literalBraces.test("lib/b"), false);
  assert.equal(minimatch.makeRe(""), false);
  assert.equal(minimatch.makeRe("#comment"), false);
});

test("real import rules retain callable, constructor, allow and forbid enforcement", async (t) => {
  const directory = await fixture(t);
  for (const path of ["consumer", "lib/public", "lib/private", "lib/.hidden"]) await mkdir(join(directory, path), { recursive: true });
  for (const path of ["lib/public/item.js", "lib/private/item.js", "lib/public.js", "lib/private/public.js", "lib/.hidden/item.js"]) {
    await writeFile(join(directory, path), "export default 1;\n");
  }
  const check = async (rule, options, source, expected, file = "check.js") => {
    const [result] = await linter(directory, { [rule]: ["error", options] }).lintText(source, { filePath: join(directory, file) });
    assert.equal(result.errorCount, expected, JSON.stringify(result.messages));
    assert.ok(result.messages.every((message) => message.ruleId === rule));
  };
  await check("import/no-namespace", { ignore: ["allowed-*"] }, "import * as A from 'allowed-lib'; import * as B from 'blocked-lib';", 1);
  await check("import/no-restricted-paths", { basePath: directory, zones: [{ target: "./consumer/**", from: "./lib/private/**" }] },
    "import '../lib/private/item.js';", 1, "consumer/check.js");
  await check("import/no-internal-modules", { allow: ["**/public/**"] },
    "import './lib/public/item.js'; import './lib/private/item.js';", 1);
  await check("import/no-internal-modules", { allow: ["lib/**/public.js"] }, "import './lib/public.js';", 1);
  await check("import/no-internal-modules", { forbid: ["lib/**/public.js"] },
    "import './lib/public.js'; import './lib/private/public.js';", 1);
  await check("import/no-internal-modules", { forbid: ["lib/**"] }, "import './lib/.hidden/item.js';", 1);
});

test("React and accessibility rules still execute component glob matching", async (t) => {
  const directory = await fixture(t);
  const cases = [
    ["react/forbid-component-props", { forbid: [{ propNamePattern: "data-*", allowedForPatterns: ["Safe*"] }] },
      'const view = <><SafeBox data-test="yes" /><UnsafeBox data-test="no" /></>;', 1],
    ["jsx-a11y/label-has-associated-control", { labelComponents: ["FormLabel"], controlComponents: ["Input*"], assert: "nesting" },
      "const view = <><FormLabel>Name<InputField /></FormLabel><FormLabel>Name</FormLabel></>;", 1],
    ["jsx-a11y/control-has-associated-label", { controlComponents: ["Input*"] },
      "const view = <><button><LabelText /></button><button><InputField /></button></>;", 1],
  ];
  for (const [rule, options, source, expected] of cases) {
    const [result] = await linter(directory, { [rule]: ["error", options] }).lintText(source, { filePath: join(directory, "check.jsx") });
    assert.equal(result.errorCount, expected, JSON.stringify(result.messages));
    assert.ok(result.messages.every((message) => message.ruleId === rule));
  }
});

test("ESM flat and legacy config globs preserve default-import interop and file selection", async (t) => {
  const directory = await fixture(t);
  const { ConfigArray } = await import(pathToFileURL(join(dirname(require.resolve("@eslint/config-array")), "../esm/index.js")));
  const config = new ConfigArray([{ files: ["**/*.js"], ignores: ["**/*.test.js"] }], { basePath: directory });
  config.normalizeSync();
  assert.equal(config.getConfigStatus(join(directory, "nested/a.js")), "matched");
  assert.equal(config.getConfigStatus(join(directory, "nested/a.test.js")), "unconfigured");
  const { OverrideTester } = await import(pathToFileURL(join(frontend, "node_modules/@eslint/eslintrc/lib/config-array/override-tester.js")));
  assert.equal(OverrideTester.create(["*.js"], null, directory).test(join(directory, "nested/a.js")), true);
  assert.equal(OverrideTester.create(["./*.js"], null, directory).test(join(directory, "nested/a.js")), false);
});

test("typescript-estree project service exercises the patched named minimatch API", async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, include: ["inside.ts"] }));
  await writeFile(join(directory, "inside.ts"), "export const inside = 1;\n");
  await writeFile(join(directory, "outside.ts"), "export const outside = 1;\n");
  const parser = require("@typescript-eslint/typescript-estree");
  t.after(() => parser.clearCaches());
  const options = {
    tsconfigRootDir: directory,
    filePath: join(directory, "outside.ts"),
    projectService: { allowDefaultProject: ["outside.ts"], defaultProject: "tsconfig.json" },
  };
  const result = parser.parseAndGenerateServices("export const outside = 1;", options);
  assert.ok(result.services.program);
  assert.throws(() => parser.parseAndGenerateServices("export const blocked = 1;", { ...options, filePath: join(directory, "blocked.ts") }), /not found by the project service/);
});

test("amplifying patterns complete or reject within a killable subprocess budget", async () => {
  const code = `
    const assert = require('node:assert/strict');
    const m = require('minimatch');
    try { new m.Minimatch('**/../'.repeat(30) + 'x', { optimizationLevel: 2, braceExpandMax: 16 }); }
    catch (error) { assert.match(error.message, /limit|max|expand/i); }
    assert.equal(m('src/a.js', 'src/*.js'), true);
  `;
  await promisify(execFile)(process.execPath, ["-e", code], {
    cwd: frontend, timeout: 5000, killSignal: "SIGKILL", windowsHide: true, maxBuffer: 64 * 1024,
  });
});

test("both CI jobs run the matcher regression alongside the existing Next adapter tests", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await readFile(new URL("../.github/workflows/commerce-ci.yml", import.meta.url), "utf8"));
  for (const job of ["checks", "package"]) {
    const step = workflow.jobs[job].steps.find((step) => step.run?.includes("scripts/eslint-minimatch.test.mjs"));
    assert.ok(step, job);
    assert.match(step.run, /scripts\/next-eslint-glob\.test\.mjs/);
    assert.equal(step["continue-on-error"], undefined);
  }
});
