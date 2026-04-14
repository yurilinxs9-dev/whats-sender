/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://187.127.11.117:3003/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
