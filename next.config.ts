import type { NextConfig } from "next";

// PROFILE=1 (local builds only): unminified code and the JS self-profiler allowed, to see by name
// where a frame's time goes.
const profile = process.env.PROFILE === "1";

const nextConfig: NextConfig = profile
  ? {
      async headers() {
        return [{ source: "/:path*", headers: [{ key: "Document-Policy", value: "js-profiling" }] }];
      },
      webpack(config) {
        config.optimization.minimize = false;
        return config;
      },
    }
  : {};

export default nextConfig;
