# Imagem do servidor autoritativo do HELIO (Node + Socket.IO).
#
# O contexto de build é a RAIZ do repositório — o servidor roda as MESMAS
# regras do cliente, que vivem em shared/. Ver docs/DECISOES.md #4.
#
# O servidor roda TypeScript direto (tsx), então não há passo de build: a
# máquina do cliente precisa só de Docker, não de Node.

FROM node:22-alpine
WORKDIR /app/server

# ── Dependências ────────────────────────────────────────────────────────────
# tsx está em `dependencies` (não em devDependencies): é ele que executa o
# servidor em produção.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ── Código ──────────────────────────────────────────────────────────────────
COPY shared /app/shared
COPY server/tsconfig.json ./
COPY server/src ./src

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider -q http://localhost:3000/health || exit 1

CMD ["npx", "tsx", "src/index.ts"]
