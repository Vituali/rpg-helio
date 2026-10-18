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
                 │  (interno)  │  a sala viva fica aqui, em memória
                 └──────┬──────┘
                        │  (grava a cena quando a mesa esvazia)
                        ▼
                 ┌─────────────┐
                 │  postgres   │  conta, campanha e cena   (:5432 só no loopback)
                 └─────────────┘
```

Três serviços, uma rede interna: nem a `app` nem o `postgres` publicam porta — só o Caddy fala com o
mundo. O front é estático, servido pelo próprio Caddy.

---

## Subindo (3 passos)

```powershell
cd deploy
copy .env.example .env          # só na primeira vez
# edite SITE_ADDRESS no .env (tabela abaixo)
# e gere as duas chaves novas (banco e sessão) — ver "Banco de dados" adiante
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
docker compose ps                 # app = healthy, postgres = healthy, caddy = Up
(Invoke-WebRequest "http://localhost/socket.io/?EIO=4&transport=polling").StatusCode   # 200
```

Depois de mexer no `.env`, basta `docker compose up -d`: o Caddy é recriado com o endereço novo.

Os endereços podem ser **combinados** (todos valem ao mesmo tempo), separados por vírgula — é o
melhor arranjo para jogar de fora e de casa com a mesma configuração:

```
SITE_ADDRESS=201-158-22-220.sslip.io, http://localhost, http://192.168.1.69
```

### IP público fixo: o caminho mais curto

Se o IP da sua conexão é fixo (e **seu**, não CGNAT — confira em "Pegadinha 2"), você não precisa de
DuckDNS, conta em lugar nenhum nem comprar domínio: `sslip.io` embute o IP no próprio hostname.

1. Descubra o IP: `(Invoke-RestMethod https://api.ipify.org)`.
2. Troque os pontos por hífens → `201-158-22-220.sslip.io` e ponha no `SITE_ADDRESS`.
3. Encaminhe no roteador **TCP 80** e **TCP 443** para o IP desta máquina.
4. Confirme que o mundo já enxerga:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\check-publico.ps1
```

O script testa de verdade, **de fora para dentro** (usa nós públicos), e imprime a tabela de
encaminhamento pronta. Se ainda estiver fechado, ele lista as causas prováveis — modem + roteador em
série (dois NATs), WAN diferente do IP fixo, ou bloqueio da operadora nas portas 80/443.

> Encaminhamento de porta não se confere olhando o computador: de dentro da LAN tudo responde, mesmo
> com o mundo inteiro bloqueado. Por isso o teste tem que vir de fora.
>
> **Só troque o `SITE_ADDRESS` para o domínio depois que o script disser que está aberto.** Com a
> porta fechada, o Caddy tenta o certificado a cada poucos minutos, e o Let's Encrypt bloqueia quem
> falha 5 vezes na mesma hora — o certificado atrasaria justamente quando você está testando.

**Antes de abrir a porta, defina `GM_KEY` no `deploy/.env`.** Sem ela, qualquer um que chegar na URL
entra como mestre e assume a mesa — e o endereço não é secreto: o hostname vai para o log público de
certificados (`crt.sh`) assim que o HTTPS sobe. O `check-publico.ps1` avisa se você esquecer, e o log
do servidor também. É uma senha única compartilhada, não um sistema de contas: RBAC é a Fase 4.

---

## As 4 pegadinhas (leia antes de configurar)

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
# 2. compare com o IP que o mundo vê (IPv4! — `ifconfig.me` pode devolver IPv6)
(Invoke-RestMethod https://api.ipify.org)
```

- **Iguais** → você tem IP público. Port forward funciona. 🎉
- **Diferentes** → CGNAT. Port forward está morto. Escolha:
  - pedir **IP público** à operadora (frequentemente grátis para residencial);
  - ou **Tailscale** (ver abaixo) — resolve sem IP público nenhum.

### 3. IP dinâmico

IP residencial muda sozinho. Se for usar port forward, precisa de DDNS. O **DuckDNS já resolve
isso**: um script simples (ou o próprio container) atualiza o registro quando o IP muda.

---

### 4. IPv6 não tem NAT — a porta que você **não** abriu já está aberta

Esta é a pegadinha que derruba mais gente que se auto-hospeda, porque ela não aparece em nenhum
tutorial de port forwarding. No IPv4, nada entra sem regra explícita: você encaminha 80 e 443, e só
essas portas existem para o mundo. **No IPv6 não há NAT nem port forwarding.** Se o provedor te dá
um IPv6 global (hoje é o padrão no Brasil), cada aparelho da casa já tem endereço público, e tudo
que estiver escutando nele está ao alcance da internet.

Aconteceu exatamente aqui: com `SITE_ADDRESS=:80`, o Docker publica a porta em `[::]` (todos os
endereços IPv6, inclusive o global). O jogo ficou acessível da internet por IPv6 **antes** de
qualquer port forwarding, com o IPv4 ainda fechado. A prova foi barata: um serviço de leitura
remoto buscou a página e ela apareceu, com `User-Agent` de Linux — ou seja, não era esta máquina.

O risco não é só o jogo. Na mesma rede, uma impressora, uma câmera, um NAS ou a própria interface
do roteador também podem estar escutando em IPv6, e esses aparelhos quase nunca têm firewall
próprio (o Windows tem e bloqueia entrada por padrão). Ou seja: **o problema é da rede inteira, não
do HELIO.**

**Como fechar** — as duas, não uma:

1. **No roteador (a correção de verdade, protege a casa toda).** Na interface do Nokia G-1425G-B,
   ache a seção de firewall **IPv6** e deixe a entrada como **deny / block** por padrão. Libere
   portas só se precisar. Enquanto isso não for feito, nada do resto importa muito.
2. **No compose (a rede de segurança do projeto).** As portas são publicadas em IPv4
   (`0.0.0.0:80:80`) e em IPv6 **apenas no loopback** (`[::1]:80:80`) — nunca em `[::]`. Assim o
   `http://localhost` continua funcionando, mas a máquina não escuta IPv6 nenhum vindo da rua.
   Já está assim no `docker-compose.yml` (decisão #13): **não troque de volta para `"80:80"`.**

**Como conferir.** De dentro da própria rede não dá — a conexão nem sai, e o teste sempre "passa".
Use o **celular com o Wi-Fi desligado** (dados móveis têm IPv6) e abra `http://[seu-ipv6]/`. Se não
carregar, está fechado — que é o esperado. Para ver o endereço:

```powershell
Get-NetIPAddress -AddressFamily IPv6 |
  Where-Object { $_.IPAddress -notlike 'fe80*' -and $_.IPAddress -ne '::1' } |
  Select-Object IPAddress, InterfaceAlias
```

## Caminho recomendado: Cloudflare Tunnel (sem abrir porta nenhuma)

Se o objetivo é expor sem mexer no roteador e sem deixar o PC escutando na internet, é este. O
`cloudflared` abre uma conexão de **saída** para a Cloudflare; o mundo entra por lá. Nada de port
forwarding, funciona atrás de CGNAT, o seu IP de casa não aparece para quem visita, o HTTPS vem de
graça (a Cloudflare termina o TLS na borda) e o jogador só clica no link — não instala nada.

```powershell
cd deploy
docker compose --profile tunnel up -d
docker compose logs cloudflared | Select-String trycloudflare
```

A última linha traz algo como `https://algo-aleatorio.trycloudflare.com`. É o seu link.

Dois detalhes que importam:

- **A URL troca quando o container reinicia.** No modo rápido (`--url`, sem conta e sem domínio) o
  endereço é sorteado a cada subida. Ótimo para teste e apresentação; para uso contínuo, veja
  "URL fixa" abaixo.
- **Esse link não aparece no log de Certificate Transparency.** `trycloudflare.com` usa certificado
  coringa, então o subdomínio sorteado não é catalogado — na prática é um link **não-listado**, que
  não é achado por varredura. É a diferença de segurança mais importante em relação a um domínio
  próprio, cujo nome vai para o `crt.sh` no minuto em que o certificado sai.

### URL fixa (quando quiser deixar de ser sorteada)

Precisa de um domínio (o mais barato serve) apontado para a Cloudflare; aí a URL passa a ser sua e
permanente. Com o domínio lá, ligue o **Cloudflare Access** (grátis até 50 usuários): só quem você
convidar consegue **chegar** no servidor, com login por e-mail. Isso resolve na borda o que o
`GM_KEY` resolve dentro do jogo, e é o mais perto de um "login com autorização" de verdade sem
escrever RBAC ainda.

> **Não misture túnel com `SITE_ADDRESS` de domínio.** No modo rápido, deixe `SITE_ADDRESS=:80` e
> pronto. Se você puser um domínio em `SITE_ADDRESS` enquanto o túnel aponta para `http://caddy:80`,
> o Caddy responde um redirecionamento para `https://seu-dominio`, o navegador volta pelo túnel, e
> você entra num **loop de redirecionamento**. Ao migrar para a URL fixa com domínio, aponte o túnel
> para `https://caddy:443` e deixe o Caddy cuidar do TLS.

## Alternativa: Tailscale (se o grupo é fechado)

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

## Banco de dados e backup

O Postgres guarda **conta, campanha e a cena da mesa** (mapa, paredes, fog, NPCs). É o que faz o F5
e o restart do container não apagarem a partida — ver ADR #17. Ele sobe junto com o resto, sem passo
extra:

```powershell
docker compose up -d --build
docker compose logs app            # deve dizer "[banco] conectado (migrations em dia)"
```

Três variáveis novas no `.env` (detalhe em `.env.example`):

| Variável | Para que |
|---|---|
| `POSTGRES_PASSWORD` | senha do banco; troque por uma sua |
| `SESSION_SECRET` | assina o cookie de sessão (ADR #16) |
| `SEED_MASTER_USER` / `SEED_MASTER_PASS` | conta de mestre criada no primeiro boot, se não existir |

A porta 5432 é publicada **só no loopback** (`127.0.0.1`): dá para abrir um cliente de banco nesta
máquina, mas nada na rede alcança. É de propósito — um banco com senha não é lugar para repetir a
lição do IPv6 (pegadinha #4).

**Se o banco estiver fora, a mesa abre do mesmo jeito**, em memória, e o log avisa:

```
[banco] tentativa 6/6 falhou: getaddrinfo ENOTFOUND postgres — seguindo em memória
```

Nesse modo nada é gravado: dá para jogar a sessão inteira, mas ela não sobrevive a um restart. Isso é
de propósito. Derrubar a mesa por causa do banco seria pior do que não ter banco.

### Backup

A campanha é o dado insubstituível — são as horas que vocês passaram jogando. O volume `pg_data`
guarda tudo, mas **volume não é backup**: ele morre junto com o Docker Desktop, com um `down -v`
distraído ou com o disco.

```powershell
# um arquivo por dia, na pasta que quiser
cmd /c "docker exec helio-postgres pg_dump -U helio -d helio -Fc > C:\Backup\helio-2026-10-18.dump"
```

> O `cmd /c` não é frescura: o PowerShell 5.1 trata a saída de um comando nativo como texto e
> **corrompe** redirecionamento binário. O `cmd` faz isso do jeito certo. Use `POSTGRES_USER` e
> `POSTGRES_DB` do seu `.env` se você trocou os padrões.

Restaurando (num banco limpo):

```powershell
cmd /c "docker exec -i helio-postgres pg_restore -U helio -d helio --clean --if-exists < C:\Backup\helio-2026-10-18.dump"
```

---

## Comandos

```powershell
docker compose up -d --build      # sobe/atualiza
docker compose logs -f app        # logs do servidor de jogo
docker compose logs -f caddy      # logs do proxy/TLS
docker compose down               # derruba (os dados ficam no volume)
docker compose down -v            # derruba e apaga o banco — a campanha vai junto!
```

> **Mexeu no `Caddyfile` ou no front?** Rebuilde o `caddy` (`docker compose up -d --build caddy`).
> Ele é quem serve o front e quem roteia `/socket.io/*` e `/auth/*` para o app — e é a imagem mais
> fácil de esquecer, porque o serviço `app` é o que aparece nos logs do jogo.
>
> **Mexeu só no servidor?** `docker compose up -d --build app` basta, e o túnel não é recriado (a URL
> pública continua a mesma). Rebuildar o `cloudflared` sorteia URL nova.

## Arquivos

| Arquivo | Papel |
|---|---|
| `deploy/docker-compose.yml` | define os serviços `app`, `caddy` e `postgres` |
| `deploy/Dockerfile` | build multi-stage: compila o front e serve com Caddy |
| `deploy/Caddyfile` | serve o front estático + proxy do WebSocket **e do `/auth/*`** + TLS; o endereço vem de `SITE_ADDRESS` |
| `deploy/install.ps1` | instala Docker (se preciso) e sobe o stack |
| `deploy/check-publico.ps1` | testa, de fora para dentro, se a internet já alcança o servidor |
| `deploy/.env.example` | modelo das variáveis (endereço, `GM_KEY`, banco, sessão) |
| `deploy/.env` | **não vai pro git** — a sua configuração real; crie a partir do exemplo |
| `server/migrations/*.sql` | esquema do banco, em SQL numerado (ADR #17) |
| `.dockerignore` | evita copiar `node_modules`/`dist` para a imagem |

> O front é compilado **dentro** do Docker (estágio `node` do `deploy/Dockerfile`).
> A máquina do cliente precisa apenas de Docker — **não** de Node/npm instalado.

## Portas

| Porta | De onde | Para onde | Precisa abrir no roteador? |
|---|---|---|---|
| 80 | internet/LAN/tailnet | Caddy | sim — é onde o jogo roda em `SITE_ADDRESS=:80` e onde o cert é validado |
| 443 | internet/tailnet | Caddy | só se usar domínio (HTTPS) |
| 5173 | só local | Vite dev | **não** (só desenvolvimento) |
| 5432 | só local (`127.0.0.1`) | postgres | **não** — é para desenvolvimento; nada na rede alcança |
| porta do `app` | — | — | **nunca** (interna do compose) |
| 2375/2376 (Docker API) | — | — | **nunca, jamais** |
