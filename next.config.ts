import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit usa __dirname para carregar fontes (AFM/ICC); sem externalização,
  // o Turbopack dev virtualiza o caminho (D:\ROOT\...) e a leitura falha.
  // web-push usa require dinâmico internamente; externo evita falhas de bundle.
  serverExternalPackages: ["pdfkit", "web-push"],
  // O openresty do painel da iContainer reescreve o Host upstream para
  // 127.0.0.1:8080, o que derruba a checagem CSRF de Server Actions do Next
  // (Origin ≠ x-forwarded-host). Liberamos as origens reais do site:
  // o subdomínio gratuito, o domínio provisório e o domínio definitivo
  // do cliente (painel.medicoemdomicilio.com).
  experimental: {
    serverActions: {
      allowedOrigins: [
        "clinica.vps10746.panel.icontainer.run",
        "homecare.vhex.app",
        "painel.medicoemdomicilio.com",
      ],
    },
  },
};

export default nextConfig;
