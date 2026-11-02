"use strict";

const modern = require("minimatch-safe");

// Legacy makeRe joins pattern parts with mandatory slashes: unlike match(),
// foo/**/bar must not allow foo/bar or an extra trailing slash. Keep that
// contract with an iterative matcher, never by generating a regular expression.
function makeRe(compiled) {
  if (compiled.comment || compiled.empty) return false;
  const { options } = compiled;
  const rows = compiled.globSet.map((glob) => glob.split(/\/+/).map((part) => ({
    globstar: part === "**" && !options.noglobstar,
    empty: part === "",
    matcher: new modern.Minimatch(part, {
      ...options, platform: "linux", nonegate: true, nocomment: true,
      // globSet already expanded braces, including escaped literal braces.
      matchBase: false, partial: false, noglobstar: true, nobrace: true,
    }),
  })));
  return Object.freeze({
    test(value) {
      const parts = value.split("/");
      const matched = rows.some((row) => {
        let reachable = new Uint8Array(parts.length + 1);
        reachable[0] = 1;
        for (const { globstar, empty, matcher } of row) {
          const next = new Uint8Array(parts.length + 1);
          for (let index = 0; index < parts.length; index++) {
            const item = parts[index];
            if (globstar) {
              const allowedAfterSlash = options.dot ? item !== "." && item !== ".." : !item.startsWith(".");
              // The first separator is outside legacy **'s regex. Its dot guard
              // applies at string start and subsequent separators, not that one.
              if (!/[\r\n\u2028\u2029]/.test(item) &&
                  ((reachable[index] && (index > 0 || allowedAfterSlash)) || (next[index] && allowedAfterSlash))) {
                next[index + 1] = 1;
              }
            } else if (reachable[index] && (item !== "" || empty) && matcher.match(item)) {
              next[index + 1] = 1;
            }
          }
          reachable = next;
        }
        return Boolean(reachable[parts.length]);
      });
      return compiled.negate ? !matched : matched;
    },
  });
}

// The pinned ESLint 9/plugins expect a callable CommonJS default, unlike v11.
// Keep their matching APIs, but delegate all parsing/execution to patched v11.
function defaults(base = {}) {
  const options = (overrides = {}) => {
    const { allowWindowsEscape, ...merged } = { optimizationLevel: 0, ...base, ...overrides };
    return {
      ...merged,
      windowsPathsNoEscape: merged.windowsPathsNoEscape ??
        ((merged.platform ?? process.platform) === "win32" && !allowWindowsEscape),
    };
  };
  const pattern = (value) => typeof value === "string" ? value.trim() : value;
  const minimatch = (value, glob, overrides) => modern.minimatch(value, pattern(glob), options(overrides));
  class Minimatch extends modern.Minimatch {
    constructor(glob, overrides) {
      super(pattern(glob), options(overrides));
    }
    static defaults(overrides) {
      return defaults({ ...base, ...overrides }).Minimatch;
    }
  }
  return Object.assign(minimatch, {
    Minimatch,
    GLOBSTAR: modern.GLOBSTAR,
    sep: modern.sep,
    defaults: (overrides) => defaults({ ...base, ...overrides }),
    filter: (glob, overrides) => modern.filter(pattern(glob), options(overrides)),
    match: (values, glob, overrides) => modern.match(values, pattern(glob), options(overrides)),
    braceExpand: (glob, overrides) => modern.braceExpand(glob, options(overrides)),
    // import/no-internal-modules uses only makeRe(...).test(path). v11 removed
    // regex generation; intentionally expose only that predicate, not a RegExp.
    makeRe: (glob, overrides) => makeRe(new Minimatch(glob, overrides)),
  });
}

module.exports = defaults();
