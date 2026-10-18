#requires -Version 5.1
<#
.SYNOPSIS
    HELIO — sobe o servidor de RPG com um comando.
.DESCRIPTION
    Garante o Docker, builda o front e sobe o stack via docker compose.
    Pensado para o cliente: "baixa, roda 1 script, acessa pelo IP".
.NOTES
    Docker Desktop no Windows exige: admin, WSL2, virtualizacao na BIOS e
    (na primeira instalacao) um reboot. Sem isso o script para e avisa.
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$deploy = Join-Path $root "deploy"

function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "  $m" -ForegroundColor Red }

Write-Host "`n  HELIO — servidor de RPG`n" -ForegroundColor Magenta

# ── 1. Docker presente? ────────────────────────────────────────────────────
Write-Host "[1/3] Verificando Docker..." -ForegroundColor White
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    Warn "Docker nao encontrado."
    Warn "A instalacao exige ADMIN, WSL2, virtualizacao na BIOS e um REBOOT."
    $resp = Read-Host "  Instalar o Docker Desktop agora via winget? (s/N)"
    if ($resp -ne "s") { Fail "Instale o Docker Desktop manualmente e rode de novo."; exit 1 }

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail "winget nao encontrado. Instale o Docker Desktop manualmente:"; 
        Fail "https://www.docker.com/products/docker-desktop/"; exit 1
    }
    winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements
    Warn "Docker instalado. REINICIE o computador e rode este script de novo."
    exit 0
}
Ok "Docker encontrado."

# ── 2. Docker respondendo? ─────────────────────────────────────────────────
Write-Host "[2/3] Verificando se o Docker esta rodando..." -ForegroundColor White
try { docker info *> $null } catch {
    Fail "O Docker esta instalado mas nao esta rodando. Abra o Docker Desktop e tente de novo."
    exit 1
}
Ok "Docker ativo."

Write-Host "[3/3] Subindo os containers (o front e buildado dentro do Docker)..." -ForegroundColor White
Push-Location $deploy
try {
    if (-not (Test-Path ".env")) {
        Warn "Sem .env — usando valores padrao. Copie .env.example para personalizar."
    }
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { throw "docker compose falhou." }
} finally { Pop-Location }

$ip = (Invoke-RestMethod https://ifconfig.me/ip -ErrorAction SilentlyContinue)
if (-not $ip) { $ip = "SEU-IP" }

Write-Host "`n  Pronto!`n" -ForegroundColor Green
Write-Host "  Acesse:  https://helio.duckdns.org   (Opcao A - DuckDNS)"
Write-Host "           http://SEU-IP              (Opcao C - HTTP puro)"
Write-Host "  IP publico detectado: $ip"
Write-Host ""
Write-Host "  Comandos uteis (dentro de deploy/):"
Write-Host "    docker compose logs -f     # ver logs"
Write-Host "    docker compose down        # parar"
Write-Host "    docker compose down -v     # parar e apagar dados"
Write-Host ""
Warn "Lembrete: se a operadora usa CGNAT, abrir porta nao funciona (ver docs/DEPLOY.md)."
