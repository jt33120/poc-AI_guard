/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: import.meta.dirname,
  },
  // La page de l'extension porte le nom du produit ; l'ancienne adresse y mène.
  async redirects() {
    return [{ source: "/extension", destination: "/secret-guard", permanent: true }];
  },
};

export default nextConfig;
