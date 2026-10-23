"use strict";

const { isAbsolute } = require("node:path");
const { globSync: safeGlobSync } = require("tinyglobby");

// Next 16.4.2 uses only this directory-discovery API. The override is scoped
// to that plugin version until upstream removes its unpatched braces chain.
function globSync(pattern, options) {
  if (typeof pattern !== "string" || options?.onlyDirectories !== true ||
      Object.keys(options).some((key) => key !== "onlyDirectories")) {
    throw new TypeError("Next ESLint glob adapter supports only directory discovery.");
  }
  return safeGlobSync(pattern, {
    onlyDirectories: true,
    expandDirectories: false,
    absolute: isAbsolute(pattern),
  }).map((path) => path === "/" || /^[a-z]:\/$/i.test(path) ? path : path.replace(/\/$/, ""));
}

module.exports = { globSync };
