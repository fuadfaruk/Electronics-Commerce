import type { NextConfig } from "next";
import { validateStorefrontConfig } from "./src/lib/api/config-validation";

validateStorefrontConfig(process.env);

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle in `.next/standalone` so the app can be
  // deployed without the full `node_modules` tree (see the deploy workflow).
  output: "standalone",
};

export default nextConfig;
