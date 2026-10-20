import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output is what the Docker image runs. Windows dev machines
  // without symlink privileges can skip it locally with NEXT_OUTPUT=off.
  ...(process.env.NEXT_OUTPUT === 'off' ? {} : { output: 'standalone' }),
  // Shared package is consumed as TypeScript source from the workspace.
  transpilePackages: ['@ride-master/shared'],
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
