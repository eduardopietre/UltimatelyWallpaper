$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outDir = Join-Path $root "dist"
$zipPath = Join-Path $outDir "icloud-calendar-wallpaper-lively.zip"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$include = @(
    "index.html",
    "LivelyInfo.json",
    "LivelyProperties.json",
    "css",
    "js"
)

$tempDir = Join-Path $env:TEMP ("lively-pack-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
    foreach ($item in $include) {
        $source = Join-Path $root $item
        if (-not (Test-Path $source)) {
            throw "Missing required path: $item"
        }
        Copy-Item -Path $source -Destination (Join-Path $tempDir $item) -Recurse -Force
    }

    if (Test-Path $zipPath) {
        Remove-Item $zipPath -Force
    }

    Compress-Archive -Path (Join-Path $tempDir "*") -DestinationPath $zipPath -Force
    Write-Host "Created $zipPath"
}
finally {
    if (Test-Path $tempDir) {
        Remove-Item $tempDir -Recurse -Force
    }
}
