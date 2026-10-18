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
# As migrations em SQL ficam FORA de src/ de propósito: são dado, não código, e
# são lidas do disco em runtime. Ver ADR #17.
COPY server/migrations ./migrations

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# ── Usuário sem privilégio ──────────────────────────────────────────────────
# O processo não precisa de root para nada: as salas vivem em memória e nada é
# escrito em disco. Rodar como `node` (uid 1000) limita bastante o estrago se
# alguém conseguir executar código aqui dentro. O cache do npm vai para /tmp
# porque o container roda com o filesystem somente-leitura
# (ver `read_only` em deploy/docker-compose.yml).
ENV NPM_CONFIG_CACHE=/tmp/.npm
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider -q http://localhost:3000/health || exit 1

CMD ["npx", "tsx", "src/index.ts"]
