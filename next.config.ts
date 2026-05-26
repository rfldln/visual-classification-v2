import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevents Webpack from trying to bundle the postgres-js native driver.
  // It stays as a real Node.js require() at runtime.
  serverExternalPackages: ["postgres"],

  images: {
    remotePatterns: [
      {
        // Default Cloudflare R2 public bucket domain
        protocol: "https",
        hostname: "**.r2.dev",
      },
      {
        // Custom R2 public domain (set via R2_PUBLIC_URL env var)
        protocol: "https",
        hostname: process.env.R2_PUBLIC_URL
          ? new URL(process.env.R2_PUBLIC_URL).hostname
          : "localhost",
      },
    ],
  },
};

export default nextConfig;
