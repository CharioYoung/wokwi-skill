<#
  compile.ps1 - Compile an Arduino sketch for Wokwi simulation.

  Why this exists:
    wokwi-cli does NOT compile ESP32 Arduino sketches. You must provide a
    firmware binary. This script wraps arduino-cli with sane defaults and
    avoids the classic "non-ASCII path breaks ld.exe" failure.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/compile.ps1 -Project .\examples\01-traffic-light
    powershell -ExecutionPolicy Bypass -File scripts/compile.ps1 -Project <dir> -Fqbn esp32:esp32:esp32s3
    powershell -ExecutionPolicy Bypass -File scripts/compile.ps1 -Project <dir> -DataDir "C:\wokwi-toolchain\data" -BuildDir "C:\wokwi-toolchain\build"

  ASCII-only on purpose (PowerShell 5.1 reads BOM-less .ps1 as GBK).
#>
param(
  [Parameter(Mandatory=$true)][string]$Project,
  [string]$Fqbn = "esp32:esp32:esp32",
  [string]$DataDir = "",
  [string]$BuildDir = "",
  [string]$OutDir = ""
)

$ErrorActionPreference = "Continue"

function Find-ArduinoCli {
  $cmd = Get-Command arduino-cli.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command arduino-cli -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in @("C:\wokwi\bin\arduino-cli.exe", "C:\tools\arduino-cli\arduino-cli.exe")) {
    if (Test-Path $c) { return $c }
  }
  return $null
}

function Test-AsciiPath { param([string]$p) return ($p -notmatch '[^\x00-\x7F]') }

$cli = Find-ArduinoCli
if (-not $cli) {
  Write-Host "[FAIL] arduino-cli not found." -ForegroundColor Red
  Write-Host "       Install: https://github.com/arduino/arduino-cli/releases" -ForegroundColor Yellow
  Write-Host "       Then:    arduino-cli core install esp32:esp32" -ForegroundColor Yellow
  exit 1
}

$proj = (Resolve-Path $Project).Path
if (-not (Test-Path $proj)) { Write-Host ("[FAIL] project not found: " + $Project) -ForegroundColor Red; exit 1 }

$inos = @(Get-ChildItem -Path $proj -Filter *.ino -File -ErrorAction SilentlyContinue)
if ($inos.Count -eq 0) {
  Write-Host ("[FAIL] no .ino file in " + $proj) -ForegroundColor Red
  exit 1
}
if ($inos.Count -gt 1) {
  Write-Host ("[WARN] {0} .ino files found; Arduino will compile all of them and duplicate symbols may appear:" -f $inos.Count) -ForegroundColor Yellow
  $inos | ForEach-Object { Write-Host ("       - " + $_.Name) -ForegroundColor Yellow }
  Write-Host "       Keep exactly one .ino per project." -ForegroundColor Yellow
}

# arduino-cli requires: <folder>\<folder>.ino  (folder name == sketch name)
if ($inos.Count -eq 1) {
  $sketchName = [System.IO.Path]::GetFileNameWithoutExtension($inos[0].Name)
  $folderName = Split-Path $proj -Leaf
  if ($sketchName -ne $folderName) {
    Write-Host " "
    Write-Host "[FAIL] sketch folder name must match the .ino file name." -ForegroundColor Red
    Write-Host ("       folder : " + $folderName) -ForegroundColor Yellow
    Write-Host ("       sketch : " + $inos[0].Name) -ForegroundColor Yellow
    Write-Host ("       arduino-cli looks for: {0}\{0}.ino" -f $folderName) -ForegroundColor Yellow
    Write-Host ("       fix    : rename the folder to '" + $sketchName + "', or rename the .ino to '" + $folderName + ".ino'") -ForegroundColor Yellow
    exit 1
  }
}

if (-not $DataDir) {
  if (Test-Path "C:\wokwi-toolchain\data") { $DataDir = "C:\wokwi-toolchain\data" }
  elseif (Test-Path (Join-Path $env:LOCALAPPDATA "Arduino15")) { $DataDir = Join-Path $env:LOCALAPPDATA "Arduino15" }
  else { $DataDir = "C:\wokwi-toolchain\data" }
}
if (-not $BuildDir) { $BuildDir = "C:\wokwi-toolchain\build" }
if (-not $OutDir)   { $OutDir   = Join-Path $proj "build" }

if (-not (Test-AsciiPath $BuildDir)) {
  Write-Host ("[FAIL] build dir contains non-ASCII characters: " + $BuildDir) -ForegroundColor Red
  Write-Host "       ld.exe cannot handle it. Use e.g. C:\wokwi-toolchain\build" -ForegroundColor Yellow
  exit 1
}

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host " "
Write-Host "=== compiling ===" -ForegroundColor Cyan
Write-Host ("  project  : " + $proj)
Write-Host ("  fqbn     : " + $Fqbn)
Write-Host ("  data dir : " + $DataDir)
Write-Host ("  build    : " + $BuildDir)
Write-Host ("  output   : " + $OutDir)
Write-Host " "

# NOTE: no `2>&1` on native exe - PowerShell 5.1 converts stderr to error
# records and would abort before we can print our own diagnosis.
$compileLog = Join-Path $BuildDir "arduino-cli.compile.log"
& $cli --config-dir $DataDir compile --fqbn $Fqbn --build-path $BuildDir --output-dir $OutDir $proj *> $compileLog
$code = $LASTEXITCODE
if (Test-Path $compileLog) { Get-Content $compileLog | ForEach-Object { Write-Host $_ } }

if ($code -ne 0) {
  Write-Host " "
  Write-Host ("[FAIL] compile exit " + $code) -ForegroundColor Red
  Write-Host "       See references/07-troubleshooting.md (section B)" -ForegroundColor Yellow
  exit $code
}

$bins = @(Get-ChildItem -Path $OutDir -Filter *.bin -File -ErrorAction SilentlyContinue)
if ($bins.Count -eq 0) {
  Write-Host " "
  Write-Host ("[FAIL] compile reported success but no .bin in " + $OutDir) -ForegroundColor Red
  exit 1
}

Write-Host " "
foreach ($b in $bins) {
  Write-Host ("[OK] {0}  {1} bytes" -f $b.Name, $b.Length) -ForegroundColor Green
}
Write-Host " "
Write-Host ("Next: make sure wokwi.toml points at '" + $bins[0].Name + "'") -ForegroundColor Cyan
exit 0
