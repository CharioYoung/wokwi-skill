<#
  check-env.ps1 - Verify the toolchain needed by wokwi-builder.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
    powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1 -DataDir "C:\wokwi-toolchain\data" -BuildDir "C:\wokwi-toolchain\build"

  Exit code: 0 = all pass, 1 = something failed.

  ASCII-only on purpose (Windows PowerShell 5.1 reads BOM-less .ps1 as GBK).
#>
param(
  [string]$DataDir = "",
  [string]$BuildDir = ""
)

$ErrorActionPreference = "Continue"
$script:fail = 0
$script:warn = 0

function Ok   { param($name, $msg) Write-Host ("[PASS] {0,-16} {1}" -f $name, $msg) -ForegroundColor Green }
function Bad  { param($name, $msg) Write-Host ("[FAIL] {0,-16} {1}" -f $name, $msg) -ForegroundColor Red; $script:fail++ }
function Warn { param($name, $msg) Write-Host ("[WARN] {0,-16} {1}" -f $name, $msg) -ForegroundColor Yellow; $script:warn++ }

function Find-Exe {
  param([string]$Name, [string[]]$Candidates)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in $Candidates) { if (Test-Path $c) { return $c } }
  return $null
}

function Test-AsciiPath {
  param([string]$p)
  return ($p -notmatch '[^\x00-\x7F]')
}

Write-Host " "
Write-Host "=== wokwi-builder environment check ===" -ForegroundColor Cyan
Write-Host " "

# --- 1. wokwi-cli ---
$wokwi = Find-Exe "wokwi-cli.exe" @("C:\wokwi\bin\wokwi-cli.exe", (Join-Path $env:USERPROFILE ".wokwi\bin\wokwi-cli.exe"), "C:\wokwi\bin\wokwi-cli")
if ($wokwi) {
  $v = & $wokwi --version 2>$null
  Ok "wokwi-cli" ("{0}  ({1})" -f ($v -join " ").Trim(), $wokwi)
} else {
  Bad "wokwi-cli" "not found. Install from https://github.com/wokwi/wokwi-cli/releases"
}

# --- 2. token ---
$token = $env:WOKWI_CLI_TOKEN
$tokenSrc = "env"
if (-not $token) {
  $mcp = Join-Path $env:USERPROFILE ".workbuddy\mcp.json"
  if (Test-Path $mcp) {
    try {
      $j = Get-Content $mcp -Raw -Encoding UTF8 | ConvertFrom-Json
      $token = $j.mcpServers.'wokwi-cli'.env.WOKWI_CLI_TOKEN
      $tokenSrc = "mcp.json"
    } catch { }
  }
}
if ($token) {
  if ($token -match '^wok_' -and $token.Length -eq 44) {
    Ok "WOKWI_CLI_TOKEN" ("wok_****  (44 chars, from {0})" -f $tokenSrc)
  } else {
    Warn "WOKWI_CLI_TOKEN" ("unexpected format: len={0}, prefix={1}. Expected 44 chars starting with wok_" -f $token.Length, $token.Substring(0,[Math]::Min(4,$token.Length)))
  }
} else {
  Bad "WOKWI_CLI_TOKEN" "not set. Generate one at wokwi.com (CI/API token page)"
}

# --- 3. arduino-cli ---
$acli = Find-Exe "arduino-cli.exe" @("C:\wokwi\bin\arduino-cli.exe", "C:\tools\arduino-cli\arduino-cli.exe")
if ($acli) {
  $v = & $acli version 2>$null
  Ok "arduino-cli" ("{0}  ({1})" -f ($v -join " ").Trim(), $acli)
} else {
  Bad "arduino-cli" "not found. Install from https://github.com/arduino/arduino-cli/releases"
}

# --- 4. esp32 core ---
if (-not $DataDir) {
  if (Test-Path "C:\wokwi-toolchain\data") { $DataDir = "C:\wokwi-toolchain\data" }
  elseif (Test-Path (Join-Path $env:LOCALAPPDATA "Arduino15")) { $DataDir = Join-Path $env:LOCALAPPDATA "Arduino15" }
  else { $DataDir = "C:\wokwi-toolchain\data" }
}
if ($acli) {
  $list = & $acli --config-dir $DataDir core list 2>$null
  $hit = $list | Where-Object { $_ -match '^esp32:esp32' }
  if ($hit) {
    Ok "esp32 core" ("{0}  (data dir: {1})" -f ($hit -join "; ").Trim(), $DataDir)
  } else {
    Bad "esp32 core" ("not installed in {0}. Run: arduino-cli --config-dir `"{0}`" core install esp32:esp32" -f $DataDir)
  }
  if (-not (Test-AsciiPath $DataDir)) {
    Warn "data dir" "contains non-ASCII characters; the linker may fail. Prefer C:\wokwi-toolchain\data"
  }
}

# --- 5. node ---
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $v = & node --version 2>$null
  $major = 0
  if ($v -match 'v(\d+)') { $major = [int]$Matches[1] }
  if ($major -ge 18) { Ok "node" ("{0}  ({1})" -f $v, $node.Source) }
  else { Warn "node" ("{0} is old; scripts need v18+" -f $v) }
} else {
  Warn "node" "not found; verify_viewer.js / domrun.js will be unavailable"
}

# --- 6. build dir ---
if (-not $BuildDir) { $BuildDir = "C:\wokwi-toolchain\build" }
$asciiOk = Test-AsciiPath $BuildDir
if ($asciiOk) {
  try {
    New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
    Ok "build dir" ("{0}  (ASCII, writable)" -f $BuildDir)
  } catch {
    Bad "build dir" ("{0} is not writable" -f $BuildDir)
  }
} else {
  Bad "build dir" ("{0} contains non-ASCII characters; ld.exe will fail. Use C:\wokwi-toolchain\build" -f $BuildDir)
}

# --- summary ---
Write-Host " "
if ($script:fail -eq 0) {
  Write-Host ("RESULT: all checks passed ({0} warning(s))" -f $script:warn) -ForegroundColor Green
  Write-Host " "
  exit 0
} else {
  Write-Host ("RESULT: {0} check(s) failed, {1} warning(s)" -f $script:fail, $script:warn) -ForegroundColor Red
  Write-Host "See references/02-environment.md for the fix for each item." -ForegroundColor Yellow
  Write-Host " "
  exit 1
}
