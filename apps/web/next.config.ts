import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // ffmpeg-based local media worker and Trigger.dev SDK run on the server only.
  serverExternalPackages: ["@trigger.dev/sdk"],
  async headers() {
    // JASSUB (libass in WASM) runs multi-threaded when the page is cross-origin isolated.
    return [
      {
        source: "/projects/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
