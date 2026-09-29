import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // build standalone pour une image Docker légère (déploiement VPS)
  output: "standalone",
};

export default nextConfig;
