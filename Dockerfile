# syntax=docker/dockerfile:1
# Build de produção do app (Next.js + Prisma) para a VPS.
FROM node:22-alpine AS deps
WORKDIR /app
# libc6-compat/openssl: exigidos pelos engines nativos do Prisma no alpine.
# tzdata: resolução do TZ=America/Sao_Paulo (agenda/lembretes no fuso da clínica).
RUN apk add --no-cache libc6-compat openssl tzdata
COPY package.json package-lock.json ./
# O schema do Prisma precisa estar presente antes do npm ci,
# pois o postinstall roda `prisma generate`.
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN apk add --no-cache libc6-compat openssl tzdata
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY package.json next.config.ts ./
EXPOSE 3000
CMD ["npm", "start"]
