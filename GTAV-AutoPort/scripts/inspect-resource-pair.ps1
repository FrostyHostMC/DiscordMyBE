Add-Type -AssemblyName System.Windows.Forms

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $projectRoot "native-inspector/Cargo.toml"

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Rust and Cargo are required. Install the stable Rust toolchain from https://rustup.rs/ and try again.",
        "GTAV AutoPort - Rust required",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    exit 1
}

$yftDialog = New-Object System.Windows.Forms.OpenFileDialog
$yftDialog.Title = "Select the main vehicle YFT (for example glendale.yft)"
$yftDialog.Filter = "GTA V YFT resource (*.yft)|*.yft"
if ($yftDialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
$yftPath = $yftDialog.FileName

$ytdDialog = New-Object System.Windows.Forms.OpenFileDialog
$ytdDialog.Title = "Select the matching vehicle YTD (for example glendale.ytd)"
$ytdDialog.Filter = "GTA V YTD texture dictionary (*.ytd)|*.ytd"
if ($ytdDialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
$ytdPath = $ytdDialog.FileName

$folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog
$folderDialog.Description = "Choose an output folder for the native inspection reports"
if ($folderDialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
$outputPath = Join-Path $folderDialog.SelectedPath "GTAV-AutoPort-Native-Reports"
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

Push-Location $projectRoot
try {
    Write-Host "Inspecting YFT: $yftPath"
    & cargo run --release --manifest-path $manifestPath -- $yftPath $outputPath
    if ($LASTEXITCODE -ne 0) { throw "YFT inspection failed with exit code $LASTEXITCODE." }

    Write-Host "Inspecting YTD: $ytdPath"
    & cargo run --release --manifest-path $manifestPath -- $ytdPath $outputPath
    if ($LASTEXITCODE -ne 0) { throw "YTD inspection failed with exit code $LASTEXITCODE." }

    $message = "Inspection completed." + [Environment]::NewLine + [Environment]::NewLine + "Output folder:" + [Environment]::NewLine + $outputPath + [Environment]::NewLine + [Environment]::NewLine + "Open AutoPort and choose Load native reports, then select this folder."
    [System.Windows.Forms.MessageBox]::Show(
        $message,
        "GTAV AutoPort - Inspection complete",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    Start-Process explorer.exe -ArgumentList $outputPath
}
catch {
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        "GTAV AutoPort - Inspection failed",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    exit 1
}
finally {
    Pop-Location
}
