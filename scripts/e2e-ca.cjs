const fs = require("node:fs");
const tls = require("node:tls");

// Test-only trust of the operator-selected localhost certificate. Verification stays enabled.
if (process.env.E2E_TLS_CERT) {
  tls.setDefaultCACertificates([
    ...tls.getCACertificates("default"),
    fs.readFileSync(process.env.E2E_TLS_CERT, "utf8"),
  ]);
}
