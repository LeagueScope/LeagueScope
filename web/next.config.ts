import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Standalone output for self-hosted deployments (no node_modules needed)
  output: 'standalone',

  // Monorepo root - avoids "multiple lockfiles" warning
  outputFileTracingRoot: path.join(__dirname, '..'),

  // API proxy: handled by src/app/api/[...path]/route.ts (Route Handler)
  // Rewrites to external URLs are unreliable on AWS Amplify WEB_COMPUTE,
  // so we use a server-side Route Handler instead.

  // Security & caching headers (mirrors backend helmet config)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: https://cdn.pandascore.co https://cdn-api.pandascore.co https://raw.githubusercontent.com https://flagcdn.com",
              "connect-src 'self' http://localhost:3001 https://wwzhhxf7jd.eu-west-3.awsapprunner.com https://leaguescope.com https://www.leaguescope.com",
              "object-src 'none'",
              "frame-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },

  // Allow images from external CDNs used in LeagueScope
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.pandascore.co' },
      { protocol: 'https', hostname: 'cdn-api.pandascore.co' },
      { protocol: 'https', hostname: 'raw.githubusercontent.com' },
      { protocol: 'https', hostname: 'flagcdn.com' },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },
};

export default nextConfig;
