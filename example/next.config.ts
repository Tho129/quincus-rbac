import path from "node:path";
import type { NextConfig } from "next";

// The example imports the package's source (../src) through tsconfig paths,
// the way an app imports the published package. Turbopack's root is the repo
// root so it compiles files outside this folder and finds node_modules there.
const nextConfig: NextConfig = {
  turbopack: { root: path.join(__dirname, "..") },
};

export default nextConfig;
