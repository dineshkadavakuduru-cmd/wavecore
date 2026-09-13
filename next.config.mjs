/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three + postprocessing ship ESM that benefits from being transpiled by Next.
  transpilePackages: ["three"],
};

export default nextConfig;
