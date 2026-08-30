import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit usa __dirname para carregar fontes (AFM/ICC); sem externalização,
  // o Turbopack dev virtualiza o caminho (D:\ROOT\...) e a leitura falha.
  // web-push usa require dinâmico internamente; externo evita falhas de bundle.
  serverExternalPackages: ["pdfkit", "web-push"],
  // O proxy reescreve o Host upstream, o que derrubaria a checagem CSRF de
  // Server Actions do Next (Origin ≠ x-forwarded-host). Liberamos apenas o
  // domínio definitivo em produção (painel.medicoemdomicilio.com).
  experimental: {
    serverActions: {
      allowedOrigins: [
        "painel.medicoemdomicilio.com",
      ],
    },
  },
};

export default nextConfig;
