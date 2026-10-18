# Deploy

## Resumo

Self-hosted com Docker Compose: um comando sobe o front, o servidor de jogo e o Caddy (proxy
reverso com HTTPS). O cliente só instala o Docker, roda um PS1 e acessa. É melhor que Firebase
**para este jogo** (ver `DECISOES.md` #2), mas herda a parte chata de rede — que é o que este
documento resolve.

```
                 Internet (ou Tailscale)
                        │
                        ▼
                 ┌─────────────┐
                 │    Caddy    │  :80 / :443   TLS + headers + proxy reverso
                 └──────┬──────┘
            estático    │    /socket.io  (WebSocket)
                        ▼
                 ┌─────────────┐
                 │     app     │  Node + Socket.IO + regras de jogo
                 │  (interno)  │  volume: dados das salas
                 └─────────────┘
```

Dois serviços, uma rede interna: a `app` **não publica porta nenhuma**, só o Caddy fala com o mundo.

---

## Subindo (3 passos)

```powershell
cd deploy
copy .env.example .env          # só na primeira vez
# edite SITE_ADDRESS no .env (tabela abaixo)
docker compose up -d --build
```

O endereço é controlado por **uma variável só**, `SITE_ADDRESS`:

| `SITE_ADDRESS` | URL para o grupo | HTTPS | Precisa |
|---|---|---|---|
| `:80` **← padrão** | `http://localhost` e `http://192.168.1.69` (LAN) | ❌ | nada |
| `helio.duckdns.org` | `https://helio.duckdns.org` | automático | DuckDNS + portas 80/443 |
| `189-40-12-7.sslip.io` | `https://189-40-12-7.sslip.io` | automático | IP fixo + portas 80/443 |
| `helio-pc.tailXXXX.ts.net` | `https://helio-pc.tailXXXX.ts.net` | automático | Tailscale |

**Comece no `:80`.** Ele responde em *qualquer* host, então funciona tanto em `http://localhost`
quanto em `http://<IP-da-máquina>` — dá para juntar o grupo na mesma casa e conferir que o jogo
funciona antes de mexer em roteador, DNS ou certificado. Quando estiver de pé, troque pelo domínio.

Conferindo que subiu:

```powershell
docker compose ps                 # app = healthy, caddy = Up
(Invoke-WebRequest "http://localhost/socket.io/?EIO=4&transport=polling").StatusCode   # 200
```

Depois de mexer no `.env`, basta `docker compose up -d`: o Caddy é recriado com o endereço novo.

---

## As 3 pegadinhas (leia antes de configurar)

### 1. HTTPS num IP pelado

O grande atrativo do Caddy é emitir TLS sozinho — mas o Let's Encrypt **não emite certificado para
IP**, só para domínio. Então:

| `SITE_ADDRESS` | HTTPS | Precisa comprar? | Observação |
|---|---|---|---|
| **`:80`** (padrão) | ❌ | não | HTTP puro. Já funciona em `localhost` e na LAN. **Quebra voz/WebRTC** depois (`getUserMedia` exige contexto seguro) |
| **IP fixo + sslip.io** | ✅ | não | `189-40-12-7.sslip.io` — sem DDNS, o IP não muda. **Melhor opção com IP fixo** |
| **DuckDNS** (`helio.duckdns.org`) | ✅ | não | subdomínio grátis; Caddy emite cert automático. Bom p/ IP dinâmico |
| **sslip.io / nip.io** (`203-0-113-5.sslip.io`) | ✅ | não | o IP vai no próprio hostname; também pega cert |
| Domínio próprio | ✅ | sim | melhor a longo prazo |

**Comece em `:80` para testar com o grupo na mesma rede; para jogar de fora, IP fixo + `sslip.io`**
(sem DDNS, certificado automático) ou DuckDNS se o IP mudar. Nos dois casos é só trocar o
`SITE_ADDRESS` no `deploy/.env` e rodar `docker compose up -d` de novo.

### 2. CGNAT — o assassino silencioso

Muitas operadoras brasileiras (Vivo Fibra, Claro/NET…) colocam clientes residenciais atrás de
NAT de operadora. Nesse caso você **não tem IP público** e **abrir porta no roteador não faz nada**.

Teste obrigatório, antes de perder tempo:

```powershell
# 1. veja o IP WAN no painel do roteador (Status / WAN)
# 2. compare com o IP que o mundo vê:
(Invoke-RestMethod https://ifconfig.me/ip)
```

- **Iguais** → você tem IP público. Port forward funciona. 🎉
- **Diferentes** → CGNAT. Port forward está morto. Escolha:
  - pedir **IP público** à operadora (frequentemente grátis para residencial);
  - ou **Tailscale** (ver abaixo) — resolve sem IP público nenhum.

### 3. IP dinâmico

IP residencial muda sozinho. Se for usar port forward, precisa de DDNS. O **DuckDNS já resolve
isso**: um script simples (ou o próprio container) atualiza o registro quando o IP muda.

---

## Caminho recomendado: Tailscale (se o grupo é fechado)

Se quem vai jogar são pessoas conhecidas, **Tailscale** é de longe o menor atrito:

- Instala em cada máquina (Windows tem instalador gráfico).
- Cria uma rede privada entre elas. **Sem abrir porta, sem CGNAT, sem IP público.**
- HTTPS automático via MagicDNS (`tailscale cert`), sem DuckDNS.
- O acesso é privado: só quem está na rede vê o servidor.

Trade-off: cada jogador precisa instalar o Tailscale. Para uma mesa de amigos, isso é 2 minutos.

No `deploy/.env`, `SITE_ADDRESS=helio-pc.tailXXXX.ts.net` já basta: o Caddy pega o certificado
via `tailscale cert`/MagicDNS e serve em HTTPS na tailnet. Portas 80/443 não precisam ser abertas
para a internet. O resto do stack não muda.

---

## Alternativa: DuckDNS + port forward (acesso público)

1. Crie `seu-nome.duckdns.org` e aponte pro seu IP.
2. No roteador, redirecione **443 → IP-da-máquina:443** (e **80 → :80** para o desafio do cert).
3. Suba o stack. O Caddy emite o certificado na primeira requisição.
4. Atualizador de DDNS (o IP muda): rode o container `linuxserver/duckdns` no mesmo compose.

---

## O PS1 do cliente

Objetivo: *"baixa, roda 1 script, servidor no ar"*.

O que o `deploy/install.ps1` faz:

1. Checa se o **Docker Desktop** existe. Se não existe:
   - avisa que vai instalar (precisa de **admin**, **WSL2**, virtualização na **BIOS** e um **reboot**);
   - instala via `winget install Docker.DockerDesktop`;
   - para e pede reboot (não dá pra continuar sem).
2. Espera o Docker responder (`docker info`).
3. `docker compose up -d --build`.
4. Espera o healthcheck do Caddy e imprime a URL (`https://helio.duckdns.org` ou o IP).
5. Mostra os comandos úteis (`logs`, `down`, `restart`).

> **Realidade do Windows:** Docker Desktop é pesado (WSL2 + virtualização + reboot). Se quiser algo
> realmente "abre e roda" sem instalar nada, a saída é `docs/DEPLOY.md` → seção "Sem Docker"
> (abaixo), com binários standalone.

### Sem Docker (zero instalação)

Para eliminar o peso do Docker Desktop no cliente:

- **Node standalone**: empacotar o servidor com `node --experimental-sea-config` (Node SEA) ou
  `pkg` → um `.exe` único.
- **Caddy** também é um `.exe` único, sem instalador.
- O PS1 baixa os dois numa pasta e executa. Sem WSL2, sem virtualização, sem reboot.

Mais trabalho de empacotamento, mas é o que entrega o "só abre e roda" de verdade. Fica como
opção de Fase 4.

---

## Comandos

```powershell
docker compose up -d --build      # sobe/atualiza
docker compose logs -f app        # logs do servidor de jogo
docker compose logs -f caddy      # logs do proxy/TLS
docker compose down               # derruba
docker compose down -v            # derruba e apaga os dados salvos
```

## Arquivos

| Arquivo | Papel |
|---|---|
| `deploy/docker-compose.yml` | define os serviços `app` e `caddy` |
| `deploy/Dockerfile` | build multi-stage: compila o front e serve com Caddy |
| `deploy/Caddyfile` | serve o front estático + proxy do WebSocket + TLS; o endereço vem de `SITE_ADDRESS` |
| `deploy/install.ps1` | instala Docker (se preciso) e sobe o stack |
| `deploy/.env.example` | modelo das variáveis (`SITE_ADDRESS`, `ROOM_CODE`, `ORIGIN`) |
| `deploy/.env` | **não vai pro git** — a sua configuração real; crie a partir do exemplo |
| `.dockerignore` | evita copiar `node_modules`/`dist` para a imagem |

> O front é compilado **dentro** do Docker (estágio `node` do `deploy/Dockerfile`).
> A máquina do cliente precisa apenas de Docker — **não** de Node/npm instalado.

## Portas

| Porta | De onde | Para onde | Precisa abrir no roteador? |
|---|---|---|---|
| 80 | internet/LAN/tailnet | Caddy | sim — é onde o jogo roda em `SITE_ADDRESS=:80` e onde o cert é validado |
| 443 | internet/tailnet | Caddy | só se usar domínio (HTTPS) |
| 5173 | só local | Vite dev | **não** (só desenvolvimento) |
| porta do `app` | — | — | **nunca** (interna do compose) |
| 2375/2376 (Docker API) | — | — | **nunca, jamais** |
