<#
  install.ps1 - Install the wokwi-builder skill into an agent skills directory.

  Usage:
    powershell -ExecutionPolicy Bypass -File install.ps1
    powershell -ExecutionPolicy Bypass -File install.ps1 -Claude
    powershell -ExecutionPolicy Bypass -File install.ps1 -Target "C:\my\skills"

  Default target:
    %USERPROFILE%\.workbuddy\skills   (if .workbuddy exists)
    %USERPROFILE%\.claude\skills      (fallback, or when -Claude is used)

  This file is ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less
  .ps1 files as GBK and will fail to parse non-ASCII characters.
#>
param(
  [string]$Target = "",
  [switch]$Claude
)

$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Target) {
  if ($Claude) {
    $Target = Join-Path $env:USERPROFILE ".claude\skills"
  } elseif (Test-Path (Join-Path $env:USERPROFILE ".workbuddy")) {
    $Target = Join-Path $env:USERPROFILE ".workbuddy\skills"
  } else {
    $Target = Join-Path $env:USERPROFILE ".claude\skills"
  }
}

$dest = Join-Path $Target "wokwi-builder"

if (Test-Path $dest) {
  Write-Host ("removing previous install: " + $dest)
  Remove-Item -Recurse -Force $dest
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$items = @("SKILL.md", "README.md", "LICENSE", "references", "scripts", "assets", "examples")
$copied = 0
foreach ($i in $items) {
  $p = Join-Path $src $i
  if (Test-Path $p) {
    Copy-Item -Recurse -Force $p (Join-Path $dest $i)
    $copied++
  }
}

Write-Host " "
Write-Host ("[OK] installed {0} item(s) to: {1}" -f $copied, $dest)
Write-Host " "
Write-Host "Next steps:"
Write-Host ("  1. verify toolchain : powershell -ExecutionPolicy Bypass -File `"" + (Join-Path $dest "scripts\check-env.ps1") + "`"")
Write-Host  "  2. read the manual  : references/00-quickstart.md"
Write-Host  "  3. try it           : wokwi: make an ESP32 traffic light"
