#requires -Version 5.1
<#
.SYNOPSIS
    Diz se a internet já enxerga o servidor HELIO, de fora para dentro.

.DESCRIPTION
    Encaminhamento de porta é a única parte do deploy que não dá para conferir
    olhando o computador: o teste tem que vir de FORA. Este script usa nós
    públicos (check-host.net) para bater na sua porta 80 e na 443 e responde,
    item por item, o que já está de pé e o que falta.

    Não precisa de admin e não muda nada — só mede.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File deploy\check-publico.ps1
.EXAMPLE
    # conferindo outro endereço (o do colega que vai hospedar)
    powershell -ExecutionPolicy Bypass -File deploy\check-publico.ps1 -Ip 189.40.12.7
#>
param(
    [string]$Ip
)

$ErrorActionPreference = "Stop"
$hdr = @{ Accept = "application/json"; "User-Agent" = "helio-deploy-check" }

function Row($ok, $label, $detail) {
    $mark = if ($ok) { "[ok]  " } else { "[FALTA] " }
    $color = if ($ok) { "Green" } else { "Red" }
    Write-Host ("  {0}{1,-42} {2}" -f $mark, $label, $detail) -ForegroundColor $color
}

function Ask-Port([string]$Host_, [int]$Port) {
    # Devolve $true/$false, ou $null se os nós não responderam.
    try {
        $req = Invoke-RestMethod "https://check-host.net/check-tcp?host=$Host_`:$Port&max_nodes=4" -Headers $hdr -TimeoutSec 25
    } catch { return $null }
    $res = @{}
    for ($i = 0; $i -lt 8; $i++) {
        Start-Sleep -Seconds 3
        try { $r = Invoke-RestMethod "https://check-host.net/check-result/$($req.request_id)" -Headers $hdr -TimeoutSec 25 } catch { continue }
        foreach ($n in $r.PSObject.Properties) { if ($null -ne $n.Value) { $res[$n.Name] = $n.Value } }
        if ($res.Count -ge 3) { break }
    }
    if ($res.Count -eq 0) { return $null }
    $abertas = 0
    foreach ($v in $res.Values) { if ($v.time) { $abertas++ } }
    return ($abertas -ge 2)     # maioria dos nós
}

Write-Host ""
Write-Host "HELIO - o mundo enxerga o servidor?" -ForegroundColor Cyan
Write-Host ("-" * 72)

# ── 1. Qual é o IPv4 de saída ────────────────────────────────────────────────
if (-not $Ip) {
    try { $Ip = (Invoke-RestMethod "https://api.ipify.org" -TimeoutSec 15).Trim() }
    catch { Write-Host "  Nao consegui descobrir o IP publico (sem internet?)." -ForegroundColor Red; exit 1 }
}
Write-Host "  IP publico desta rede: $Ip" -ForegroundColor White

$ssl = ($Ip -replace '\.', '-') + ".sslip.io"

# ── 2. Checagens ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "DNS" -ForegroundColor DarkGray
$dnsOk = $false
try {
    $dns = Resolve-DnsName $ssl -Type A -Server 8.8.8.8 -ErrorAction Stop
    $dnsOk = ($dns | Where-Object { $_.IPAddress -eq $Ip }).Count -gt 0
} catch { $dnsOk = $false }
Row $dnsOk "$ssl resolve" $(if ($dnsOk) { "-> $Ip" } else { "nao resolveu para $Ip" })

Write-Host ""
Write-Host "Portas vistas DA INTERNET (nos externos)" -ForegroundColor DarkGray
$ok80 = Ask-Port $Ip 80
$ok443 = Ask-Port $Ip 443
Row ($ok80 -eq $true) "TCP 80  (HTTP + certificado)" $(if ($null -eq $ok80) { "sem resposta dos nos" } elseif ($ok80) { "ABERTA" } else { "timeout: ninguem de fora entra" })
Row ($ok443 -eq $true) "TCP 443 (HTTPS)" $(if ($null -eq $ok443) { "sem resposta dos nos" } elseif ($ok443) { "ABERTA" } else { "timeout: ninguem de fora entra" })

Write-Host ""
Write-Host "Aqui dentro" -ForegroundColor DarkGray
foreach ($p in 80, 443) {
    $l = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    Row ([bool]$l) "porta $p escutando nesta maquina" $(if ($l) { "sim (Docker/Caddy)" } else { "nao: o stack nao esta no ar" })
}

# ── 3. Guarda-corpo: porta aberta + sem senha de mestre ──────────────────────
if ($ok80 -eq $true -or $ok443 -eq $true) {
    Write-Host ""
    Write-Host "Entrada" -ForegroundColor DarkGray

    $envFile = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) ".env"
    $gmKey = $null
    if (Test-Path $envFile) {
        $hit = Select-String -Path $envFile -Pattern '^\s*GM_KEY\s*=' | Select-Object -First 1
        if ($hit) { $gmKey = ($hit.Line -split '=', 2)[1].Trim() }
    }

    if ($null -eq $gmKey) {
        Row $false "senha de mestre (GM_KEY)" "deploy/.env nao encontrado"
    } elseif ($gmKey -eq "") {
        Row $false "senha de mestre (GM_KEY)" "VAZIA"
        Write-Host ""
        Write-Host "  ATENCAO: a porta esta aberta e NAO ha senha de mestre." -ForegroundColor Red
        Write-Host "  Qualquer um que chegar na URL entra como MESTRE e controla a mesa." -ForegroundColor Red
        Write-Host "  E o endereco nao e secreto: ele fica publicado no log de" -ForegroundColor Red
        Write-Host "  certificados (crt.sh) assim que o HTTPS subir." -ForegroundColor Red
        Write-Host "  Ponha um GM_KEY no deploy/.env e rode 'docker compose up -d'." -ForegroundColor Red
    } elseif ($gmKey -match '^(123456|12345678|senha|password|admin|helio)$') {
        Row $true "senha de mestre (GM_KEY)" "definida, mas e uma senha obvia"
        Write-Host "        (combinado com o grupo por enquanto; trocar no RBAC)" -ForegroundColor DarkYellow
    } else {
        Row $true "senha de mestre (GM_KEY)" "definida"
    }
}

# ── 4. Veredito ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host ("-" * 72)
if ($ok80 -eq $true -and $ok443 -eq $true) {
    Write-Host "  TUDO PRONTO -> https://$ssl" -ForegroundColor Green
    Write-Host "  (o certificado sai sozinho na primeira conexao)" -ForegroundColor Green
} else {
    Write-Host "  FALTA ABRIR AS PORTAS NO ROTEADOR" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  No painel do roteador (192.168.1.1 ou 192.168.0.1), procure" -ForegroundColor Yellow
    Write-Host "  'Redirecionamento de Portas' / 'Port Forwarding' / 'NAT' e crie:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "      Servico     Porta externa   Protocolo   IP interno        Porta interna" -ForegroundColor White
    Write-Host "      HELIO-http      80             TCP      192.168.1.69           80" -ForegroundColor White
    Write-Host "      HELIO-https     443            TCP      192.168.1.69          443" -ForegroundColor White
    Write-Host ""
    Write-Host "  Como o IP 192.168.1.69 vem por DHCP (pode mudar), marque-o como" -ForegroundColor Yellow
    Write-Host "  FIXO: 'DHCP Reservation' / 'IP reservado' pela placa de rede." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Continua fechado depois disso?" -ForegroundColor Yellow
    Write-Host "    - confira o IP da WAN no roteador: tem que ser $Ip" -ForegroundColor DarkYellow
    Write-Host "    - tem modem + roteador? o modem tambem precisa estar em" -ForegroundColor DarkYellow
    Write-Host "      BRIDGE (ou com o mesmo encaminhamento); dois NATs em serie" -ForegroundColor DarkYellow
    Write-Host "      e a causa mais comum de 'configurei e nao funciona'" -ForegroundColor DarkYellow
    Write-Host "    - se a operadora bloqueia 80/443, use Tailscale ou um tunel" -ForegroundColor DarkYellow
}
Write-Host ""
