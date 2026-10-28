<#
  simulate.ps1 - Run a Wokwi headless simulation and assert on the serial log.

  Facts baked in:
    * --timeout is in SIMULATION milliseconds (not wall clock).
    * Local simulation runs roughly 5x slower than wall clock.
    * A long-running sketch ends with exit code 42 (timeout) - that is normal.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/simulate.ps1 -Project .\examples\01-traffic-light -Timeout 14000
    powershell -ExecutionPolicy Bypass -File scripts/simulate.ps1 -Project <dir> -Expect "IP:","server started"

  Scenario (optional): a sketch that reacts to a sensor only proves itself when
  the sensor value changes mid-run. -Scenario scenario.yaml forwards the file to
  wokwi-cli --scenario, so the log shows the branch was really taken.
    powershell -File scripts/simulate.ps1 -Project .\examples\duck-robot -Scenario .\examples\duck-robot\scenario.yaml -Expect "AVOID"

  ASCII-only on purpose (PowerShell 5.1 reads BOM-less .ps1 as GBK).
#>
param(
  [Parameter(Mandatory=$true)][string]$Project,
  [int]$Timeout = 16000,
  [string[]]$Expect = @(),
  [string[]]$Fail = @(),
  [string]$Token = "",
  [string]$OutDir = "",
  [string]$Scenario = "",
  [switch]$KeepQuiet
)

$ErrorActionPreference = "Continue"

# `powershell -File script.ps1 -Expect a,b` passes "a,b" as ONE string.
# Split on commas so both calling styles work.
$Expect = @($Expect | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$Fail = @($Fail | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

function Find-WokwiCli {
  $cmd = Get-Command wokwi-cli.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command wokwi-cli -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in @("C:\wokwi\bin\wokwi-cli.exe", (Join-Path $env:USERPROFILE ".wokwi\bin\wokwi-cli.exe"))) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

$cli = Find-WokwiCli
if (-not $cli) {
  Write-Host "[FAIL] wokwi-cli not found. https://github.com/wokwi/wokwi-cli/releases" -ForegroundColor Red
  exit 1
}

$proj = (Resolve-Path $Project).Path
if (-not (Test-Path (Join-Path $proj "wokwi.toml"))) {
  Write-Host ("[FAIL] wokwi.toml not found in " + $proj) -ForegroundColor Red
  Write-Host "       Create it with: [wokwi] version=1 firmware='build/<name>.ino.bin'" -ForegroundColor Yellow
  exit 1
}

# token: param > env > mcp.json
$tok = $Token
$tokSrc = "param"
if (-not $tok) { $tok = $env:WOKWI_CLI_TOKEN; $tokSrc = "env" }
if (-not $tok) {
  $mcp = Join-Path $env:USERPROFILE ".workbuddy\mcp.json"
  if (Test-Path $mcp) {
    try {
      $j = Get-Content $mcp -Raw -Encoding UTF8 | ConvertFrom-Json
      $tok = $j.mcpServers.'wokwi-cli'.env.WOKWI_CLI_TOKEN
      $tokSrc = "mcp.json"
    } catch { }
  }
}
if (-not $tok) {
  Write-Host "[FAIL] no Wokwi token. Set WOKWI_CLI_TOKEN or pass -Token." -ForegroundColor Red
  exit 1
}
$env:WOKWI_CLI_TOKEN = $tok

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $OutDir) { $OutDir = Join-Path $proj ("sim-" + $stamp) }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$log = Join-Path $OutDir "serial.log"

$wallMin = [math]::Round($Timeout / 1000.0 * 1.5, 0)
$wallMax = [math]::Round($Timeout / 1000.0 * 5.0, 0)

Write-Host " "
Write-Host "=== simulation ===" -ForegroundColor Cyan
Write-Host ("  project   : " + $proj)
Write-Host ("  timeout   : {0} sim-ms  (may take {1}-{2}s wall clock; local sim is 1.5x-5x slower)" -f $Timeout, $wallMin, $wallMax)
Write-Host ("  log file  : " + $log)
Write-Host ("  token from: " + $tokSrc)
if ($Scenario) { Write-Host ("  scenario  : " + $Scenario) }
Write-Host " "

$sw = [Diagnostics.Stopwatch]::StartNew()
# NOTE: never pipe a native exe through 2>&1 here - PowerShell 5.1 turns each
# stderr line into an error record and aborts in Stop mode. Redirect to a file.
$cliOut = Join-Path $OutDir "wokwi-cli.out"
$scArgs = @()
if ($Scenario) { $scArgs = @("--scenario", $Scenario) }
& $cli --timeout $Timeout --serial-log-file $log @scArgs $proj *> $cliOut
$code = $LASTEXITCODE
$sw.Stop()

if (-not $KeepQuiet -and (Test-Path $cliOut)) {
  Get-Content $cliOut | ForEach-Object { Write-Host $_ }
}

Write-Host " "
Write-Host ("exit code     : {0}   ({1:N1}s wall)" -f $code, $sw.Elapsed.TotalSeconds)
if ($code -eq 42) { Write-Host "note          : 42 = timeout reached, normal for long-running sketches" -ForegroundColor Yellow }

if (-not (Test-Path $log)) {
  Write-Host ("[FAIL] no serial log produced: " + $log) -ForegroundColor Red
  Write-Host "       Check wokwi.toml firmware path and diagram.json serial wiring." -ForegroundColor Yellow
  exit 1
}

$content = Get-Content $log -Raw -ErrorAction SilentlyContinue
if (-not $content) { $content = "" }
$bytes = (Get-Item $log).Length
Write-Host ("serial log    : {0} bytes" -f $bytes)

# --- assertions ---
$pass = $true
if ($Expect.Count -gt 0) {
  Write-Host " "
  Write-Host "--- expect ---" -ForegroundColor Cyan
  foreach ($e in $Expect) {
    if ($content -match [regex]::Escape($e)) {
      Write-Host ("  [PASS] found: " + $e) -ForegroundColor Green
    } else {
      Write-Host ("  [FAIL] missing: " + $e) -ForegroundColor Red
      $pass = $false
    }
  }
}
if ($Fail.Count -gt 0) {
  Write-Host " "
  Write-Host "--- fail patterns ---" -ForegroundColor Cyan
  foreach ($f in $Fail) {
    if ($content -match [regex]::Escape($f)) {
      Write-Host ("  [FAIL] matched: " + $f) -ForegroundColor Red
      $pass = $false
    } else {
      Write-Host ("  [PASS] absent: " + $f) -ForegroundColor Green
    }
  }
}

if ($bytes -eq 0) {
  Write-Host " "
  Write-Host "[FAIL] serial log is empty. The firmware probably did not start." -ForegroundColor Red
  Write-Host "       Checklist: build/*.bin exists? wokwi.toml points to it? Serial.begin(115200) present?" -ForegroundColor Yellow
  exit 1
}

if (-not $pass) {
  Write-Host " "
  Write-Host ("[FAIL] assertions failed. Log: " + $log) -ForegroundColor Red
  Write-Host "       See references/07-troubleshooting.md (section C)" -ForegroundColor Yellow
  exit 1
}

Write-Host " "
Write-Host ("[OK] simulation verified. Log: " + $log) -ForegroundColor Green
Write-Host " "
Write-Host "Next: use this log as the rawLog source for sim-viewer.html" -ForegroundColor Cyan
exit 0
