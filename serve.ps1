# ============================================================
#  Bodega · Servidor estático local (sin dependencias)
#  Uso:  click derecho > "Ejecutar con PowerShell"
#        o:  powershell -ExecutionPolicy Bypass -File serve.ps1
#  Luego abre:  http://localhost:8123/
# ============================================================
param(
  [int]$Port = 8123,
  [string]$Root = $PSScriptRoot
)

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }
$Root = (Resolve-Path $Root).Path

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  Write-Host "No se pudo iniciar en el puerto $Port. Detalle: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host "================================================" -ForegroundColor Green
Write-Host " Bodega sirviendo en:  http://localhost:$Port/ " -ForegroundColor Green
Write-Host " Carpeta: $Root" -ForegroundColor DarkGray
Write-Host " Cierra esta ventana para detener el servidor." -ForegroundColor DarkGray
Write-Host "================================================" -ForegroundColor Green

$mime = @{
  ".html" = "text/html; charset=utf-8"; ".htm" = "text/html; charset=utf-8";
  ".css"  = "text/css; charset=utf-8";  ".js"  = "application/javascript; charset=utf-8";
  ".json" = "application/json; charset=utf-8"; ".png" = "image/png"; ".jpg" = "image/jpeg";
  ".jpeg" = "image/jpeg"; ".gif" = "image/gif"; ".svg" = "image/svg+xml"; ".ico" = "image/x-icon";
  ".woff" = "font/woff"; ".woff2" = "font/woff2"; ".map" = "application/json"
}

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }
    $path = Join-Path $Root $rel
    if (Test-Path $path -PathType Container) { $path = Join-Path $path "index.html" }

    if (Test-Path $path -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      $ct = $mime[$ext]; if (-not $ct) { $ct = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ctx.Response.ContentType = $ct
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $buf = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $rel")
      $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
    }
    $ctx.Response.OutputStream.Close()
  } catch {
    # Ignora errores de conexiones cerradas por el navegador
  }
}
