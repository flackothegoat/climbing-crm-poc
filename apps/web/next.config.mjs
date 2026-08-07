const DEFAULT_DIST_DIR = '.next';
const API_PROXY_TARGET = process.env.API_BASE_URL ?? 'http://localhost:3101/api';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? DEFAULT_DIST_DIR,
  async rewrites() {
    return [
      {
        source: '/backend/:path*',
        destination: `${API_PROXY_TARGET}/:path*`,
      },
    ];
  },
};

export default nextConfig;
