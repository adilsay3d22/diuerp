import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Uploads go through server actions; Vercel rejects request bodies over 4.5 MB, files are capped at 4 MB.
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
};

export default nextConfig;
