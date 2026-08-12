/** @type {import("next").NextConfig} */
const nextConfig = {
  // Lint is run as a dedicated verification step; this avoids Next 15's
  // legacy config detector warning for the ESLint 9 flat configuration.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
