import { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: process.env.ALLOWED_IMAGE_HOSTS
      ? process.env.ALLOWED_IMAGE_HOSTS.split(",").map((host) => ({
          protocol: "https" as const,
          hostname: host.trim(),
        }))
      : [
          { protocol: "https" as const, hostname: "localhost" },
          { protocol: "http" as const, hostname: "localhost" },
          { protocol: "https" as const, hostname: "127.0.0.1" },
          { protocol: "http" as const, hostname: "127.0.0.1" },
        ],
  },
  serverExternalPackages: [],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
