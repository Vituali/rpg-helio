#requires -Version 5.1
<#
.SYNOPSIS
    Otimiza a arte do jogo para a web e gera os manifestos.
.DESCRIPTION
    Os originais em `img/` sao gigantes (tokens 3000x3400, mapas 36 MB) e ficam
    FORA do git. Este script gera versoes pequenas em `client/public/` e um
    manifesto JSON por categoria, para o app listar e escolher a arte.

    Rode de novo sempre que adicionar arte nova em `img/`.
.NOTES
    Requer apenas .NET/System.Drawing (nativo do Windows PowerShell).
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$srcTokens = Join-Path $root "img\tokens"
$srcMaps   = Join-Path $root "img\maps"
$outTokens = Join-Path $root "client\public\tokens"
$outMaps   = Join-Path $root "client\public\maps"

Add-Type -AssemblyName System.Drawing

function New-Dir($p) { if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null } }

function Get-Slug([string]$name) {
    $s = $name.ToLowerInvariant()
    $s = $s -replace "\s+", "-"
    $s = $s -replace "[^a-z0-9\-]", ""
    $s = $s -replace "-+", "-"
    return $s.Trim("-")
}

<#
    Redimensiona uma imagem.
      -Square  : recorta o centro num quadrado antes de redimensionar (tokens)
      -Quality : qualidade JPEG 1..100 (mapas; PNG sempre sem perda)
#>
function Convert-Image {
    param(
        [string]$Src,
        [string]$Dst,
        [int]$Max,
        [switch]$Square,
        [int]$Quality = 85,
        [switch]$Jpeg
    )

    $img = [System.Drawing.Image]::FromFile($Src)
    try {
        $w = $img.Width
        $h = $img.Height
        $sx = 0; $sy = 0; $sw = $w; $sh = $h

        if ($Square) {
            $side = [Math]::Min($w, $h)
            $sx = [int](($w - $side) / 2)
            $sy = [int](($h - $side) / 2)
            $sw = $side; $sh = $side
        }

        $ratio = [Math]::Min($Max / $sw, $Max / $sh)
        if ($ratio -gt 1) { $ratio = 1 }
        $ow = [Math]::Max(1, [int][Math]::Round($sw * $ratio))
        $oh = [Math]::Max(1, [int][Math]::Round($sh * $ratio))

        $bmp = New-Object System.Drawing.Bitmap $ow, $oh
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)

        $destRect = New-Object System.Drawing.Rectangle 0, 0, $ow, $oh
        $srcRect  = New-Object System.Drawing.Rectangle $sx, $sy, $sw, $sh
        $g.DrawImage($img, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
        $g.Dispose()

        if ($Jpeg) {
            $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
                     Where-Object { $_.MimeType -eq "image/jpeg" }
            $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
            $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
                [System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
            $bmp.Save($Dst, $codec, $ep)
        } else {
            $bmp.Save($Dst, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        $bmp.Dispose()

        return @{ W = $ow; H = $oh }
    } finally {
        $img.Dispose()
    }
}

# ── Tokens (retratos) ───────────────────────────────────────────────────────
Write-Host "`n  Otimizando tokens..." -ForegroundColor Magenta
New-Dir $outTokens
$tokens = @()
if (Test-Path $srcTokens) {
    $files = Get-ChildItem $srcTokens -File -Recurse |
             Where-Object { $_.DirectoryName -eq $srcTokens -and $_.Extension -match '^\.(png|jpg|jpeg)$' }   # ignora subpastas (artes/thumbs)
    $i = 0
    foreach ($f in $files) {
        $i++
        $id  = Get-Slug $f.BaseName
        $out = Join-Path $outTokens "$id.png"
        Write-Progress -Activity "Tokens" -Status $f.Name -PercentComplete (100 * $i / $files.Count)
        Convert-Image -Src $f.FullName -Dst $out -Max 256 -Square | Out-Null
        $tokens += [pscustomobject]@{
            id   = $id
            name = $f.BaseName
            src  = "/tokens/$id.png"
        }
    }
    Write-Progress -Activity "Tokens" -Completed
}
$tokens | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $outTokens "manifest.json") -Encoding UTF8
Write-Host ("  tokens: {0} arquivos" -f $tokens.Count) -ForegroundColor Green

# ── Mapas ───────────────────────────────────────────────────────────────────
Write-Host "  Otimizando mapas..." -ForegroundColor Magenta
New-Dir $outMaps
$maps = @()
if (Test-Path $srcMaps) {
    $files = Get-ChildItem $srcMaps -File | Where-Object { $_.Extension -match '^\.(png|jpg|jpeg)$' }
    $i = 0
    foreach ($f in $files) {
        $i++
        $id  = Get-Slug $f.BaseName
        $out = Join-Path $outMaps "$id.jpg"
        Write-Progress -Activity "Mapas" -Status $f.Name -PercentComplete (100 * $i / $files.Count)
        $dim = Convert-Image -Src $f.FullName -Dst $out -Max 2400 -Quality 85 -Jpeg
        # w/h vao no manifesto para o app poder ajustar a grade ao formato do
        # mapa (sem isso o mapa aparece esticado).
        $maps += [pscustomobject]@{
            id   = $id
            name = $f.BaseName
            src  = "/maps/$id.jpg"
            w    = $dim.W
            h    = $dim.H
        }
    }
    Write-Progress -Activity "Mapas" -Completed
}
$maps | ConvertTo-Json -Depth 3 | Set-Content (Join-Path $outMaps "manifest.json") -Encoding UTF8
Write-Host ("  mapas: {0} arquivos" -f $maps.Count) -ForegroundColor Green

# ── Resumo ──────────────────────────────────────────────────────────────────
Write-Host "`n  Resultado:" -ForegroundColor Magenta
foreach ($d in @($outTokens, $outMaps)) {
    if (Test-Path $d) {
        $sz = (Get-ChildItem $d -File | Measure-Object -Property Length -Sum).Sum
        "{0,-45} {1,8:N2} MB" -f $d.Replace($root + '\', ''), ($sz / 1MB)
    }
}
Write-Host ""
