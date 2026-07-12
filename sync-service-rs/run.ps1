$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$env:CARGO_TARGET_DIR = Join-Path $Root "target"
$Exe = Join-Path $Root "target\release\sync-service-rs.exe"
if (-not (Test-Path $Exe)) {
    Write-Host "Building release binary..."
    cargo build --release
    if (-not (Test-Path $Exe)) {
        throw "Build finished but $Exe was not found. Unset CARGO_TARGET_DIR if it points elsewhere."
    }
}

# Hidden launch; exe is windows_subsystem=windows (no console).
Start-Process -FilePath $Exe -WorkingDirectory $Root -WindowStyle Hidden
