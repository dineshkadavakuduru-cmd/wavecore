/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three + postprocessing ship ESM that benefits from being transpiled by Next.
  transpilePackages: ["three"],
  // Static export — no server, no API routes, pure client-side app.
  output: "export",
  // Disable image optimization since we don't use next/image and the export
  // doesn't support the default loader without a server.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
