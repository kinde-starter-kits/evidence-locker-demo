/** @type {import('next').NextConfig} */
const nextConfig = {
  // The /api/run route runs the Mastra agent graph server-side. Keep these node
  // packages external (not bundled) so their runtime works in the Next server.
  serverExternalPackages: [
    '@mastra/core',
    '@mastra/langfuse',
    '@mastra/observability',
    '@evidence-locker/agents',
    '@evidence-locker/api-client'
  ]
};

export default nextConfig;
