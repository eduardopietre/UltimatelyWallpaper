$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$python = Join-Path $PSScriptRoot ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $python)) {
    $python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
}
if (-not (Test-Path $python)) { $python = "pythonw" }
& $python run.py @args
