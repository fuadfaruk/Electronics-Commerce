import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle in `.next/standalone` so the app can be
  // deployed without the full `node_modules` tree (see the deploy workflow).
  output: "standalone",
};

export default nextConfig;
