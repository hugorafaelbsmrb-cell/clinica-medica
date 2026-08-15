import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit usa __dirname para carregar fontes (AFM/ICC); sem externalização,
  // o Turbopack dev virtualiza o caminho (D:\ROOT\...) e a leitura falha.
  serverExternalPackages: ["pdfkit"],
  // O openresty do painel da iContainer reescreve o Host upstream para
  // 127.0.0.1:8080, o que derruba a checagem CSRF de Server Actions do Next
  // (Origin ≠ x-forwarded-host). Liberamos as origens reais do site:
  // o subdomínio gratuito e o domínio próprio (homecare.vhex.app).
  experimental: {
    serverActions: {
      allowedOrigins: [
        "clinica.vps10746.panel.icontainer.run",
        "homecare.vhex.app",
      ],
    },
  },
};

export default nextConfig;
