import type { NextConfig } from 'next';

/**
 * The browser talks to the API on the same origin (`/api/...`). In development
 * and in the sandbox preview, Next.js proxies those requests to the backend
 * running on BACKEND_URL (default http://localhost:4000). In production
 * (Stage 7) Nginx performs the same job, or NEXT_PUBLIC_API_URL can point
 * directly at the API host.
 */
const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
