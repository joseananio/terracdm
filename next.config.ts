import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: process.env.VERCEL ? undefined : "standalone",
};

export default withWorkflow(nextConfig);
