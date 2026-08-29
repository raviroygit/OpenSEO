import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server.js and only the
  // node_modules actually reachable from the app. This is what keeps the
  // runtime image small — do not remove it, the Dockerfile depends on it.
  output: 'standalone',

  // Pin the workspace root. Without this, Turbopack walks up past the repo
  // looking for a lockfile and can pick one from an unrelated parent folder.
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },

  poweredByHeader: false,

  experimental: {
    // Server Actions run behind Coolify's proxy on a custom domain, so the
    // proxied origin has to be allow-listed explicitly.
    serverActions: {
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  },
};

export default nextConfig;
