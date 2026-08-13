import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit usa __dirname para carregar fontes (AFM/ICC); sem externalização,
  // o Turbopack dev virtualiza o caminho (D:\ROOT\...) e a leitura falha.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
