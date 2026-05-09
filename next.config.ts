import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "preview-assets-au-01.kc-usercontent.com",
      },
      {
        protocol: "https",
        hostname: "assets-au-01.kc-usercontent.com",
      },
    ],
  },
};

export default nextConfig;
