# Imagem do HELIO: builda o front e serve com Caddy.
#
# Contexto de build = RAIZ do repositório (ver docker-compose.yml).
# O front é buildado DENTRO do container — a máquina do cliente precisa
# só de Docker, não de Node/npm instalado.

# ── Estágio 1: build do front ───────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ── Estágio 2: servir com Caddy ─────────────────────────────────────────────
FROM caddy:2-alpine

COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile

# Caddy já é o ENTRYPOINT da imagem oficial; nada a sobrescrever.
EXPOSE 80 443
