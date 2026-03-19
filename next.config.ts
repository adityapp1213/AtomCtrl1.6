import type { NextConfig } from "next";
import path from "path";
import { validateEnv } from "./app/lib/env-check";

validateEnv();

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-940ccf6255b54fa799a9b01050e6c227.r2.dev",
      },
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
