import https from "node:https";
import http from "node:http";
import { readFileSync } from "node:fs";

const cert = process.env.E2E_TLS_CERT;
const key = process.env.E2E_TLS_KEY;
const port = Number(process.env.E2E_TLS_PORT ?? 3443);
const targetPort = Number(process.env.E2E_HTTP_PORT ?? 3000);
if (!cert || !key || !Number.isInteger(port) || !Number.isInteger(targetPort)) throw new Error("Local TLS proxy requires explicit certificate, key and bounded ports.");

// Test-only HTTPS termination in front of the actual standalone/production Next server.
const server = https.createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (request, response) => {
  const upstream = http.request({ host: "127.0.0.1", port: targetPort, path: request.url, method: request.method, headers: { ...request.headers, "x-forwarded-proto": "https" } }, (result) => {
    response.writeHead(result.statusCode ?? 502, result.headers);
    result.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(503); response.end("Local test service unavailable."); });
  request.pipe(upstream);
});
server.listen(port, "127.0.0.1", () => console.log("Local TLS proxy ready."));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
