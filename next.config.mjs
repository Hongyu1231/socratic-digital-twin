/** @type {import("next").NextConfig} */
const nextConfig = {
  // Lint is run as a dedicated verification step; this avoids Next 15's
  // legacy config detector warning for the ESLint 9 flat configuration.
  eslint: { ignoreDuringBuilds: true },
  // The optimizer's internal fetch can't pass the site gate's credentials, and it's where the recently patched Next.js advisory lived.
  images: { unoptimized: true },
};

export default nextConfig;
